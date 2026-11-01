// Preloaded into a test server with --import: Date.now() runs ahead by the milliseconds written in the file named by CAPCOM_SKEW_FILE, so a test can age a
// token held in memory.
import fs from 'node:fs';

const real = Date.now;
Date.now = () => {
  try {
    return real() + Number(fs.readFileSync(process.env.CAPCOM_SKEW_FILE, 'utf8') || 0);
  } catch {
    return real();
  }
};
