"use strict";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function readGooglePasswordCsv(text) {
  const rows = parseCsv(String(text || "").replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("That CSV does not contain any password entries.");
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const column = (name) => headers.indexOf(name);
  const urlColumn = column("url");
  const nameColumn = column("name");
  const usernameColumn = column("username");
  const passwordColumn = column("password");
  const noteColumn = column("note");
  if (usernameColumn < 0 || passwordColumn < 0 || (urlColumn < 0 && nameColumn < 0)) {
    throw new Error("This is not a Google Password Manager CSV export.");
  }
  return rows.slice(1).map((row) => ({
    site: String(row[urlColumn] || row[nameColumn] || "").trim(),
    username: String(row[usernameColumn] || "").trim(),
    password: String(row[passwordColumn] || ""),
    note: noteColumn >= 0 ? String(row[noteColumn] || "") : "",
    source: "google"
  })).filter((entry) => entry.site && entry.username && entry.password);
}

module.exports = {
  parseCsv,
  readGooglePasswordCsv
};
