# Dietary Policy Validator (Lab 1)

## Run the policy service locally

The policy service is called by the NutriTrack Express backend on `127.0.0.1`; do not call it directly from the browser.

From the repository root, create and activate a virtual environment inside `policy-service`, install its requirements, and start Uvicorn:

```powershell
cd policy-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal, start the Express backend with `pnpm --dir backend dev`. Once all three services are running, start the frontend with `pnpm dev`.

The available policy IDs are `low_sodium_hospital`, `diabetic_hospital`, and `national_dietary_guidelines`. Rule nutrient keys are `sodium_mg`, `carbohydrate_g`, `added_sugar_g`, and `fiber_g`.

## 1. What is this project

This project is a backend API made with Python FastAPI. It checks a meal plan against a diet policy, like a low-sodium or diabetic hospital policy. The rules are saved in JSON files and not inside the code, so if a hospital wants to change a rule, we only edit the JSON file and the code stays the same.

You send a meal plan and a policy id, then the API tells you if the plan follows the policy, which rules were broken, and a compliance score.



## 2. Files and folders

The `app` folder has the API code. Inside it, `main.py` has the data models, the policy loading, the rule checking and the endpoints, while `__init__.py` just tells Python that `app` is a package. The `policies` folder has the three JSON policy files: `low_sodium_hospital.json`, `diabetic_hospital.json` and `national_dietary_guidelines.json`. The `examples` folder has sample meal plans (compliant, borderline and non_compliant) that we can use for testing. The `tests` folder has `test_api.py`, which runs the automatic tests. Lastly, `requirements.txt` is the list of libraries to install and `README.md` explains how to run it, with curl and Postman examples.



## 3. Libraries used

- **FastAPI**: makes the web API and the endpoints
- **Uvicorn**: the server that runs the app
- **Pydantic**: checks the data that we send (it comes with FastAPI)
- **pytest**: runs the tests
- **httpx**: lets pytest send fake requests to the API

## 4. What a policy rule looks like

Every rule in a policy file has an id, the nutrient it checks like `sodium_mg` or `fiber_g`, an operator (`<=`, `>=` or `between`), a threshold, a scope (per meal or per day), a severity and a source where the rule came from. The source is important because the lab is about evidence-based policy, so every rule should point to a real guideline.


## 5. How policies are loaded

When the app needs the policies, it opens the `policies` folder and reads every `.json` file there. Pydantic then checks if the structure is correct. For example, the operator must be one of the three allowed, and a "between" rule must have two numbers in the right order. Each policy is saved using its id, like `diabetic_hospital`. The files are only read one time (cached), not on every request, so it is faster.


## 6. How the score is calculated

The score is 100 x (checks passed / total checks). A per meal rule counts once for every meal, and a per day rule counts once. A warning still lowers the score, but only an error makes `compliant` become false.

In my test there were 5 checks in total (3 carb checks, 1 sugar and 1 fiber). Lunch carbs failed and daily fiber failed, so 3 out of 5 passed, which is a score of 60.


## 7. What happens when you send POST /validate

First, FastAPI reads the JSON and Pydantic checks the shape, like if the policy id and meals are there and each meal has foods. Then the app looks for the policy by its id, and if the id doesn't exist it returns 404. Next it checks that every food has the nutrients the policy needs, and if not it returns 422. After that, for every rule it adds up the nutrient (per meal or per day) and compares it with the threshold. Each failed check becomes a violation with the rule id, actual value, allowed value, message, source and severity. At the end it calculates the score and sends back the result.
