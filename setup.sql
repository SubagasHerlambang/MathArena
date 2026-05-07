-- Jalankan script ini di MySQL untuk membuat database
-- mysql -u root -p < setup.sql

CREATE DATABASE IF NOT EXISTS matharena CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE matharena;

-- Tabel users akan dibuat otomatis oleh initDB() di db.js
-- Script ini hanya memastikan database ada
SELECT 'Database matharena siap digunakan!' AS status;
