// Job numbers look like "J-0043 Spring Campaign": prefix + zero-padded number + space + name.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function formatJobNumber(n, cfg) {
  return `${cfg.prefix}${String(n).padStart(cfg.digits, '0')}`;
}

// Returns { number, rest } if the folder name starts with a job number, else null.
function parseJobNumber(folderName, cfg) {
  const m = new RegExp(`^${escapeRe(cfg.prefix)}(\\d+) (.+)$`).exec(folderName);
  return m ? { number: Number(m[1]), rest: m[2] } : null;
}

module.exports = { formatJobNumber, parseJobNumber };
