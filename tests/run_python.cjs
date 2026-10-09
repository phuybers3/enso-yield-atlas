// Run a Python test with the project's interpreter: $PYTHON, else ~/.venvs/enso/bin/python, else python3.
const {spawnSync} = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const venv = path.join(os.homedir(), '.venvs', 'enso', 'bin', 'python');
const python = process.env.PYTHON || (fs.existsSync(venv) ? venv : 'python3');
const r = spawnSync(python, process.argv.slice(2), {stdio: 'inherit', cwd: path.join(__dirname, '..')});
process.exit(r.status == null ? 1 : r.status);
