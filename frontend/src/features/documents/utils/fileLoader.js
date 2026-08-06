// src/features/documents/utils/fileLoader.js
import * as XLSX from "xlsx";

/**
 * Detect file type based on file extension.
 */
export async function detectFileType(file) {
    if (!file?.name) return null;
    const ext = file.name.split(".").pop().toLowerCase();
    switch (ext) {
        case "xlsx":
        case "xls":
            return "excel";
        case "csv":
            return "csv";
        case "json":
            return "json";
        default:
            return "unknown";
    }
}

/**
 * Normalize column headers (Vietnamese → English)
 */
function normalizeRow(row) {
    const map = {
        "họ và tên": "name",
        "đơn vị": "unit_name",
        "tên đăng nhập": "username",
        "tên người dùng": "username",
        "mật khẩu": "password",
        // allow synonyms
        "full name": "name",
        "org": "unit_name",
        "username": "username",
        "password": "password",
    };

    const normalized = {};
    for (const [key, val] of Object.entries(row)) {
        const k = key.trim().toLowerCase();
        const newKey = map[k] || k;
        normalized[newKey] = val;
    }
    return normalized;
}

/**
 * Load Excel/XLSX or CSV via XLSX lib
 */
async function loadExcelLike(file) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    return rows.map(normalizeRow);
}

/**
 * Load JSON file
 */
async function loadJson(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : [data];
    return arr.map(normalizeRow);
}

/**
 * Main entry: detect file type and load accordingly
 */
export async function loadFile(file) {
    if (!file) throw new Error("No file provided");

    const type = await detectFileType(file);

    switch (type) {
        case "excel":
        case "csv":
            return await loadExcelLike(file);
        case "json":
            return await loadJson(file);
        default:
            throw new Error(`Unsupported file type: ${file.name}`);
    }
}
