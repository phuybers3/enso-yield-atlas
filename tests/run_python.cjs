// Use the activated interpreter, with explicit overrides for scheduled checks.
const {spawnSync} = require('child_process'), fs = require('fs'), path = require('path');
const venv = path.resolve(__dirname, '../../.venv/bin/python');
const python = process.env.ENSO_PYTHON || process.env.PYTHON || (fs.existsSync(venv) ? venv : 'python3');
const r = spawnSync(python, process.argv.slice(2), {stdio: 'inherit', cwd: path.join(__dirname, '..')});
process.exit(r.status == null ? 1 : r.status);
