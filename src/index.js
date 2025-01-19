export default {
	async fetch(request, env, context) {
	  const url = new URL(request.url);

	  if (url.pathname === '/requests/record' && request.method === 'POST') {
		return this.handleRecordRequest(request, env);
	  } else if (url.pathname === '/requests/record/ipunknown' && request.method === 'POST') {
		return this.handleRecordIpRequest(request, env);
	  } else if (url.pathname === '/requests/get/count') {
		return this.handleGetCountRequest(request, env);
	  } else if (url.pathname.startsWith('/requests/get')) {
		return this.handleGetRequest(url, env);
	  } else if (request.method === 'OPTIONS') {
		return this.handleOptions(request);
	  }

	  return new Response('Not Found', { status: 404 });
	},

	// CORS handling for OPTIONS request
	async handleOptions(request) {
	  const origin = request.headers.get('Origin');
	  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('localhost');

	  const headers = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400', // Cache the preflight response for 1 day
	  };

	  return new Response(null, { headers: headers });
	},

	// Handle recording request with the provided data
	async handleRecordRequest(request, env) {
	  const { headers } = request;
	  const authKey = headers.get('Authorization');

	  if (authKey !== env.AUTH_KEY_SECRET) {
		return new Response('Unauthorized', { status: 401 });
	  }

	  try {
		const { timestamp, domain, method, path, country } = await request.json();

		if (!timestamp || !domain || !method || !path || !country) {
		  return new Response('Bad Request: Missing required fields', { status: 400 });
		}

		const record = { timestamp, domain, method, path, country };

		try {
			// Store the new record in the database
			await this.storeRecordInDB(record, env);
		} catch (error) {
			return new Response('Error storing record in DB', { status: 500 });
		}

		return new Response('Recorded', { status: 200 });
	  } catch (error) {
		console.log('Error recording request:', error);
		return new Response('Bad Request: Invalid JSON', { status: 400 });
	  }
	},

	// Handle recording request with IP country detection
	async handleRecordIpRequest(request, env) {
	  const { headers } = request;
	  const authKey = headers.get('Authorization');

	  if (authKey !== env.AUTH_KEY_SECRET) {
		return new Response('Unauthorized', { status: 401 });
	  }

	  try {
		const { timestamp, domain, method, path } = await request.json();

		if (!timestamp || !domain || !method || !path) {
		  return new Response('Bad Request: Missing required fields', { status: 400 });
		}

		const country = request.cf.country;

		const record = { timestamp, domain, method, path, country };

		try {
			// Store the new record in the database
			await this.storeRecordInDB(record, env);
		} catch (error) {
			return new Response('Error storing record in DB', { status: 500 });
		}

		const origin = request.headers.get('Origin');
		const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('localhost');

		return new Response('Recorded', { status: 200 }, {
		  headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		  },
		});
	  } catch (error) {
		console.log('Error recording request:', error);
		return new Response('Bad Request: Invalid JSON', { status: 400 });
	  }
	},

	// Handle request to get count of records
	async handleGetCountRequest(request, env) {
	  const origin = request.headers.get('Origin');
	  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('localhost');

	  try {
		// Get number of entries in DB
		//const resp = await env.DB.prepare('SELECT COUNT(*) FROM requests').get();
		//const count = resp['COUNT(*)'];

		const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM requests").all();
		console.log(result);
		const count = result.results[0].count;

		return new Response(JSON.stringify({ count }), {
		  headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		  },
		});
	  } catch (error) {
		console.error('Error fetching count from DB:', error);
		return new Response('Error fetching count', { status: 500 });
	  }
	},

	// Handle GET requests with filters (start, end, count, etc.)
	async handleGetRequest(url, env) {
	  const params = new URLSearchParams(url.search);

	  const start = parseInt(params.get('start')) || 0;
	  const end = parseInt(params.get('end')) || Number.MAX_SAFE_INTEGER;
	  const count = Math.min(parseInt(params.get('count')) || 100, 100);
	  const offset = parseInt(params.get('offset')) || 0;
	  const domain = params.get('domain');
	  const method = params.get('method');
	  const path = params.get('path');
	  const country = params.get('country');

	  // Get records from the database with filtering
	  const records = await this.getRecordsFromDB(env, start, end, domain, method, path, country, offset, count);

	  return new Response(JSON.stringify(records), {
		headers: { 'Content-Type': 'application/json' },
	  });
	},

	// Store the new record in the database
	async storeRecordInDB(record, env) {
		await env.DB.prepare('INSERT INTO requests (timestamp, domain, method, path, country) VALUES (?, ?, ?, ?, ?)')
			.bind(record.timestamp, record.domain, record.method, record.path, record.country)
			.run();
	},

	// Retrieve filtered records from the database
	async getRecordsFromDB(env, start, end, domain, method, path, country, offset, count) {
	  try {
		const query = `
			SELECT * FROM requests
			WHERE timestamp >= ? AND timestamp <= ?
			${domain ? 'AND domain = ?' : ''}
			${method ? 'AND method = ?' : ''}
			${path ? 'AND path = ?' : ''}
			${country ? 'AND country = ?' : ''}
			ORDER BY timestamp DESC
			LIMIT ? OFFSET ?
		`;

		const params = [start, end];

		if (domain) params.push(domain);
		if (method) params.push(method);
		if (path) params.push(path);
		if (country) params.push(country);

		params.push(count, offset);

		const records = await env.DB.prepare(query).bind(...params).all();

		// Check if the result is an array and has data
		if (!Array.isArray(records) || records.length === 0) {
			return [];  // Return an empty array or handle the case where no records were found
		}

		return records.map(record => ({
			timestamp: record.timestamp,
			domain: record.domain,
			method: record.method,
			path: record.path,
			country: record.country,
		}));
	  } catch (error) {
		console.error('Error fetching records from DB:', error);
		return [];
	  }
	},

	// Utility functions (e.g., country lookup, hashing, etc.)
	async getCountryCode(ip) {
	  const response = await fetch(`https://ipinfo.io/${ip}/country?token=${IPINFO_TOKEN}`);

	  if (!response.ok) {
		return "unknown";
	  }

	  const countryCode = await response.text();
	  return countryCode.trim() || "unknown";
	},

	async hashString(input) {
	  const encoder = new TextEncoder();
	  const data = encoder.encode(input);
	  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	  const hashArray = Array.from(new Uint8Array(hashBuffer));
	  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	},
  };
  const ALLOWED_ORIGINS = [
	'https://jonasjones.dev',
	'https://www.jonasjones.dev',
	'https://blog.jonasjones.dev',
	'https://docs.jonasjones.dev',
	'https://analytics.jonasjones.dev',
	'https://wiki.jonasjones.dev',
	'https://kcomebacks.jonasjones.dev',
	'https://jonasjonesstudios.com',
	'https://lastlovedsyncify.jonasjones.dev',
	'https://syncify.jonasjones.dev',
  ];
