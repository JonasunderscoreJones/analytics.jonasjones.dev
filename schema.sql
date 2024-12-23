DROP TABLE IF EXISTS requests;
CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME, domain TEXT, method TEXT, path TEXT, country TEXT);
INSERT INTO requests (timestamp, domain, method, path, country)
VALUES
('1734918464464', 'example.com', 'GET', '/home', 'US'),
('1734918464464', 'anotherdomain.com', 'POST', '/login', 'DE'),
('1734918464464', 'yetanotherdomain.com', 'GET', '/products', 'GB'),
('1734918464464', 'coolwebsite.com', 'PUT', '/update', 'FR');
