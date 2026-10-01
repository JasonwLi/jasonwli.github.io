#!/usr/bin/env bash
# Create (once) and update the terrain bake venv at scripts/terrain/.venv.
# Idempotent: re-running only installs what is missing. Heavy; run under the lock:
#   ~/dev/dw3-lock bash scripts/terrain/setup.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
venv="$here/.venv"
py="${PYTHON:-/opt/homebrew/bin/python3.12}"
if [ ! -x "$venv/bin/python" ]; then
  echo "setup: creating $venv with $py"
  "$py" -m venv "$venv"
  "$venv/bin/python" -m pip install --quiet --upgrade pip
fi
if "$venv/bin/python" - "$here/requirements.txt" <<'PY'
import sys, re
from importlib import metadata
missing = []
for line in open(sys.argv[1]):
    line = line.split('#', 1)[0].strip()
    if not line:
        continue
    name = re.split(r'[<>=!~ \[]', line, 1)[0]
    try:
        metadata.version(name)
    except metadata.PackageNotFoundError:
        missing.append(name)
sys.exit(1 if missing else 0)
PY
then
  echo "setup: venv up to date ($venv)"
else
  echo "setup: installing requirements"
  "$venv/bin/python" -m pip install --quiet -r "$here/requirements.txt"
fi
"$venv/bin/python" -c "import numpy, scipy, PIL; print('setup: ok numpy', numpy.__version__, 'scipy', scipy.__version__, 'pillow', PIL.__version__)"
