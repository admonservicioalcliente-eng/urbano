<?php

$uri = getenv('DATABASE_URL') ?: 'postgresql://avnadmin:YOUR_PASSWORD@pg-control1965-admonservicioalcliente-1965.b.aivencloud.com:24731/nassau_ph?sslmode=require';

$fields = parse_url($uri);
if ($fields === false || empty($fields['scheme']) || empty($fields['host'])) {
    throw new RuntimeException('DATABASE_URL is missing or invalid. Example: postgresql://user:password@host:5432/dbname?sslmode=require');
}

$scheme = strtolower((string) $fields['scheme']);
$user = $fields['user'] ?? '';
$pass = $fields['pass'] ?? '';
$host = $fields['host'];
$port = $fields['port'] ?? 5432;
$dbname = ltrim($fields['path'] ?? '/', '/');

if (!extension_loaded('pdo_pgsql') && $scheme === 'postgresql') {
    throw new RuntimeException('PDO PostgreSQL is not enabled in this PHP install. Install the pdo_pgsql extension.');
}

if ($scheme === 'postgresql' || $scheme === 'postgres') {
    $dsn = sprintf(
        'pgsql:host=%s;port=%d;dbname=%s;sslmode=require',
        $host,
        $port,
        $dbname
    );
} elseif ($scheme === 'mysql') {
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $host,
        $port,
        $dbname
    );
} else {
    throw new RuntimeException('Unsupported database scheme: ' . $scheme . '. Use postgres or mysql.');
}

try {
    $db = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);

    $stmt = $db->query('SELECT version()');
    echo $stmt->fetchColumn();
} catch (PDOException $e) {
    echo 'Database connection failed: ' . $e->getMessage() . PHP_EOL;
    exit(1);
}