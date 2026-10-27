# NutriTrack

NutriTrack is a React + TypeScript meal tracking app with an Express/MongoDB API and a Python dietary policy validator.

## Run the three services

Install the JavaScript dependencies once with `pnpm install` and `pnpm --dir backend install`. For the Python service, create its environment and install its requirements:

```powershell
cd policy-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Then open three terminals from the repository root:

```powershell
# Terminal 1: policy service (run from policy-service after activating .venv)
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2: Express API
pnpm --dir backend dev

# Terminal 3: Vite frontend
pnpm dev
```

On Windows, after creating the virtual environment and installing Python requirements, `pnpm dev:all` starts all three services in separate PowerShell windows.

The policy service stays bound to `127.0.0.1:8000`; the browser calls only the Vite app and Express API. Express calls the policy validator privately on localhost.

## Dietary policy checks

Dietitians can run a policy check from an assigned patient's view. The policy IDs are `low_sodium_hospital`, `diabetic_hospital`, and `national_dietary_guidelines`. The exact nutrient names used by their rules are `sodium_mg`, `carbohydrate_g`, `added_sugar_g`, and `fiber_g`. Optional nutrients must be recorded for saved meals before a policy requiring them can be checked.
