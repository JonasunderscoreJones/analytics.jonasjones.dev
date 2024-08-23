addEventListener('fetch', event => {
	event.respondWith(handleRequest(event.request))
})

const AUTH_KEY = AUTH_KEY_SECRET
const FILE_KEY = 'analytics/requests.json'
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
	'https://syncify.jonasjones.dev'
]

async function handleRequest(request) {
	const url = new URL(request.url)

	if (url.pathname === '/requests/record' && request.method === 'POST') {
	return handleRecordRequest(request)
	} else if (url.pathname === '/requests/record/ipunknown' && request.method === 'POST') {
	return handleRecordIpRequest(request)
	} else if (url.pathname === '/requests/get/count') {
	return handleGetCountRequest(request)
	} else if (url.pathname.startsWith('/requests/get')) {
	return handleGetRequest(url)
	} else if (request.method === 'OPTIONS') {
		return handleOptions(request);
	  }

	return new Response('Not Found', { status: 404 })
}

function handleOptions(request) {
	const origin = request.headers.get('Origin');
	const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('localhost');

	const headers = {
	  'Access-Control-Allow-Origin': '*',
	  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	  'Access-Control-Max-Age': '86400', // Cache the preflight response for 1 day
	};

	return new Response(null, {
	  headers: headers,
	});
  }


async function handleRecordRequest(request) {
	const { headers } = request
	const authKey = headers.get('Authorization')

	if (authKey !== AUTH_KEY) {
	return new Response('Unauthorized', { status: 401 })
	}

	try {
	const { timestamp, domain, method, path, ipcountry } = await request.json()

	if (!timestamp || !domain || !method || !path || !ipcountry) {
		return new Response('Bad Request: Missing required fields', { status: 400 })
	}

	const record = { timestamp, domain, method, path, ipcountry }

	// Retrieve existing records from R2
	let records = await getRecordsFromR2()
	if (!records) {
		records = []
	}

	// Add new record to the list
	records.push(record)

	// Store the updated list back to R2
	await uploadRecordsToR2(records)

	return new Response('Recorded', { status: 200 })

	} catch (error) {
		console.log('Error recording request:', error)
	return new Response('Bad Request: Invalid JSON', { status: 400 })
	}
}

async function handleRecordIpRequest(request) {
	const { headers } = request
	const authKey = headers.get('Authorization')

	if (authKey !== AUTH_KEY) {
	return new Response('Unauthorized', { status: 401 })
	}

	try {
	const { timestamp, domain, method, path } = await request.json()

	if (!timestamp || !domain || !method || !path) {
		return new Response('Bad Request: Missing required fields', { status: 400 })
	}

	const ipcountry = request.cf.country

	const record = { timestamp, domain, method, path, ipcountry }

	// Retrieve existing records from R2
	let records = await getRecordsFromR2()
	if (!records) {
		records = []
	}

	// Add new record to the list
	records.push(record)

	// Store the updated list back to R2
	await uploadRecordsToR2(records)

	const origin = request.headers.get('Origin');
	const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('localhost');

	return new Response('Recorded', { status: 200 }, {
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		},
	})

	} catch (error) {
		console.log('Error recording request:', error)
	return new Response('Bad Request: Invalid JSON', { status: 400 })
	}
}

async function handleGetCountRequest(request) {
	const origin = request.headers.get('Origin');
	const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('localhost');

	const records = await getRecordsFromR2() || []
	const count = records.length
	return new Response(JSON.stringify({ count }), {
	headers: { 'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',},
	})
}

async function handleGetRequest(url) {
	const params = new URLSearchParams(url.search)

	const start = parseInt(params.get('start')) || 0
	const end = parseInt(params.get('end')) || Number.MAX_SAFE_INTEGER
	const count = Math.min(parseInt(params.get('count')) || 100, 100)
	const offset = parseInt(params.get('offset')) || 0
	const domain = params.get('domain')
	const method = params.get('method')
	const path = params.get('path')
	const ipcountry = params.get('ipcountry')

	let records = await getRecordsFromR2() || []

	let filteredRecords = records
	.filter(record => {
		return (
		record.timestamp >= start &&
		record.timestamp <= end &&
		(!domain || record.domain === domain) &&
		(!method || record.method === method) &&
		(!path || record.path === path) &&
		(!ipcountry || record.ipcountry === ipcountry)
		)
	})
	.slice(offset, offset + count)

	return new Response(JSON.stringify(filteredRecords), {
	headers: { 'Content-Type': 'application/json' },
	})
}

async function getRecordsFromR2() {
	try {
	const object = await CDN_BUCKET.get(FILE_KEY)
	if (object === null) {
		return []
	}
	const text = await object.text()
	return JSON.parse(text)
	} catch (error) {
	console.error('Error fetching records:', error)
	return []
	}
}

async function uploadRecordsToR2(records) {
	try {
	const json = JSON.stringify(records)
	await CDN_BUCKET.put(FILE_KEY, json)
	} catch (error) {
	console.error('Error uploading records:', error)
	}
}

async function getCountryCode(ip) {
	const response = await fetch(`https://ipinfo.io/${ip}/country?token=${IPINFO_TOKEN}`);

	if (!response.ok) {
	  return "unknown";
	}

	// Since the response is plain text, use response.text()
	const countryCode = await response.text();

	// Trim any whitespace (like newline characters) from the response
	const trimmedCountryCode = countryCode.trim();

	// Check if the response is a valid country code
	if (!trimmedCountryCode) {
	  return "unknown";
	}

	return trimmedCountryCode;
  }

async function hashString(input) {
	// Encode the input string as a Uint8Array (UTF-8)
	const encoder = new TextEncoder();
	const data = encoder.encode(input);

	// Hash the data using SHA-256
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);

	// Convert the hash to a hexadecimal string
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

	return hashHex;
  }
