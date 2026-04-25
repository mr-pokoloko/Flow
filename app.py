import json
import os
from pathlib import Path
from threading import Lock
from typing import Any
from datetime import date

from flask import Flask, jsonify, request, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
CSS_DIR = BASE_DIR / "css"
JS_DIR = BASE_DIR / "js"
SAMPLES_DIR = BASE_DIR / "samples"
STORE_PATH = BASE_DIR / ".flow_store.json"
STORE_LOCK = Lock()
DEFAULT_USER_ID = "1"


def default_store() -> dict[str, dict[str, Any]]:
    return {
        "expenses_by_user": {DEFAULT_USER_ID: []},
        "budgets_by_user": {DEFAULT_USER_ID: {"monthly": 5000}},
        "recurring_by_user": {DEFAULT_USER_ID: []},
    }


def read_store() -> dict[str, dict[str, Any]]:
    if not STORE_PATH.exists():
        return default_store()

    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default_store()

    store = default_store()
    if isinstance(data, dict):
        for key in store:
            value = data.get(key)
            if isinstance(value, dict):
                store[key] = value
    return store


def write_store(store: dict[str, dict[str, Any]]) -> None:
    STORE_PATH.write_text(json.dumps(store, indent=2), encoding="utf-8")


def get_user_bucket(store: dict[str, dict[str, Any]], bucket_name: str, user_id: str) -> Any:
    bucket = store.setdefault(bucket_name, {})
    if bucket_name == "budgets_by_user":
        return bucket.setdefault(user_id, {"monthly": 5000})
    return bucket.setdefault(user_id, [])


def next_item_id(items: list[dict[str, Any]], prefix: str) -> str:
    return f"{prefix}_{len(items) + 1}_{os.urandom(3).hex()}"


def normalize_expense(payload: dict[str, Any], item_id: str | None = None) -> dict[str, Any]:
    title = str(payload.get("title") or payload.get("name") or "Untitled expense").strip()
    category = str(payload.get("category") or "Other").strip() or "Other"
    expense_date = str(payload.get("date") or "").strip() or date.today().isoformat()
    return {
        "id": item_id or str(payload.get("id") or ""),
        "title": title,
        "amount": float(payload.get("amount") or 0),
        "category": category,
        "date": expense_date,
        "user_id": str(payload.get("user_id") or DEFAULT_USER_ID),
    }


def normalize_recurring(payload: dict[str, Any], item_id: str | None = None) -> dict[str, Any]:
    title = str(payload.get("title") or "Recurring expense").strip() or "Recurring expense"
    category = str(payload.get("category") or "Bills").strip() or "Bills"
    frequency = str(payload.get("frequency") or "monthly").strip() or "monthly"
    start_date = str(payload.get("start_date") or payload.get("startDate") or "").strip()
    next_due = str(payload.get("next_due") or payload.get("nextDue") or start_date).strip()
    return {
        "id": item_id or str(payload.get("id") or ""),
        "title": title,
        "amount": float(payload.get("amount") or 0),
        "category": category,
        "frequency": frequency,
        "start_date": start_date,
        "next_due": next_due,
        "user_id": str(payload.get("user_id") or DEFAULT_USER_ID),
    }


def find_item(store: dict[str, dict[str, Any]], bucket_name: str, item_id: str) -> tuple[list[dict[str, Any]] | None, dict[str, Any] | None]:
    for items in store.get(bucket_name, {}).values():
        if not isinstance(items, list):
            continue
        for item in items:
            if str(item.get("id")) == item_id:
                return items, item
    return None, None


def load_local_env() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_local_env()

app = Flask(__name__)


def build_chat_context(payload: dict) -> str:
    history = payload.get("history") or []
    context = payload.get("context") or {}
    page = str(context.get("page") or "Flow").strip()
    user = context.get("user") or {}
    budget = context.get("budget") or {}
    analytics = context.get("analytics") or {}

    transcript_lines = []
    for item in history[-8:]:
        role = "Assistant" if item.get("role") == "assistant" else "User"
        text = str(item.get("text") or "").strip()
        if text:
            transcript_lines.append(f"{role}: {text}")

    current_message = str(payload.get("message") or "").strip()

    user_summary = []
    if user.get("fullName"):
        user_summary.append(f"Name: {user['fullName']}")
    if user.get("username"):
        user_summary.append(f"Username: {user['username']}")

    budget_summary = []
    if budget.get("currency"):
        budget_summary.append(f"Currency: {budget['currency']}")
    if budget.get("monthly") is not None:
        budget_summary.append(f"Monthly budget: {budget['monthly']}")
    if analytics.get("budgetLeft") is not None:
        budget_summary.append(f"Budget left: {analytics['budgetLeft']}")
    if analytics.get("topCategory"):
        budget_summary.append(f"Top category: {analytics['topCategory']}")
    if analytics.get("predictedMonthly") is not None:
        budget_summary.append(f"Predicted monthly spending: {analytics['predictedMonthly']}")

    return (
        f"Page: {page}\n"
        f"User profile:\n{chr(10).join(user_summary) if user_summary else 'Not available'}\n"
        f"Budget snapshot:\n{chr(10).join(budget_summary) if budget_summary else 'Not available'}\n"
        f"Recent conversation:\n{chr(10).join(transcript_lines) if transcript_lines else 'No prior messages'}\n"
        f"Latest user question:\n{current_message}"
    )


def get_gemini_client() -> Any:
    from google import genai

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "Missing GEMINI_API_KEY. Add it to your environment or create a .env file in the project root."
        )
    return genai.Client(api_key=api_key)


@app.route("/api/chat", methods=["POST"])
def chat() -> tuple:
    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Please enter a message before sending."}), 400

    try:
        client = get_gemini_client()
        from google.genai import types

        response = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=build_chat_context(payload),
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You are Flow AI, a helpful finance assistant inside a student expense-tracking app. "
                    "Answer clearly, keep replies concise, use simple language, and focus on budgeting, "
                    "expense tracking, reports, savings habits, recurring bills, and financial organization. "
                    "Be practical and specific to the current page context when possible. If budget or analytics "
                    "data is present, reference it naturally. Prefer short action-oriented answers with 2 to 4 "
                    "helpful points when the user asks for advice. Flow cannot connect to bank accounts, bank APIs, "
                    "or live banking systems, so never say you can see, sync, import, verify, or analyze a user's bank "
                    "account directly unless the user has manually entered that information into Flow. Only refer to data "
                    "that is available in the app context provided to you. If a user wants to undo an expense mistake, "
                    "tell them to open the Transactions page and delete the incorrect transaction there, because deleting "
                    "that transaction is how they undo the mistake in Flow. "
                    "Do not claim to be a licensed financial advisor. "
                    "If the user asks for investment, tax, or legal advice, provide a general informational answer and "
                    "suggest verifying with a qualified professional."
                ),
                temperature=0.5,
                max_output_tokens=350,
            ),
        )
        reply = (response.text or "").strip()
        if not reply:
            reply = "I couldn't generate a reply just now. Please try again."
        return jsonify({"reply": reply})
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500
    except Exception:
        return jsonify({"error": "The chatbot could not reach Gemini right now. Please try again."}), 502


@app.route("/get_expenses/<user_id>")
def get_expenses(user_id: str):
    with STORE_LOCK:
        store = read_store()
        return jsonify(get_user_bucket(store, "expenses_by_user", user_id))


@app.route("/add_expense", methods=["POST"])
def add_expense():
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("user_id") or DEFAULT_USER_ID)

    with STORE_LOCK:
        store = read_store()
        expenses = get_user_bucket(store, "expenses_by_user", user_id)
        item_id = next_item_id(expenses, "exp")
        expense = normalize_expense(payload, item_id=item_id)
        expenses.append(expense)
        write_store(store)

    return jsonify(expense), 201


@app.route("/get_budget/<user_id>")
def get_budget(user_id: str):
    with STORE_LOCK:
        store = read_store()
        return jsonify(get_user_bucket(store, "budgets_by_user", user_id))


@app.route("/update_budget", methods=["POST"])
def update_budget():
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("user_id") or DEFAULT_USER_ID)
    monthly = float(payload.get("monthly") or 0)

    with STORE_LOCK:
        store = read_store()
        budget = get_user_bucket(store, "budgets_by_user", user_id)
        budget["monthly"] = monthly
        write_store(store)

    return jsonify(budget)


@app.route("/get_recurring/<user_id>")
def get_recurring(user_id: str):
    with STORE_LOCK:
        store = read_store()
        return jsonify(get_user_bucket(store, "recurring_by_user", user_id))


@app.route("/add_recurring", methods=["POST"])
def add_recurring():
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("user_id") or DEFAULT_USER_ID)

    with STORE_LOCK:
        store = read_store()
        recurring = get_user_bucket(store, "recurring_by_user", user_id)
        item_id = next_item_id(recurring, "rec")
        item = normalize_recurring(payload, item_id=item_id)
        recurring.append(item)
        write_store(store)

    return jsonify(item), 201


@app.route("/delete_recurring/<item_id>", methods=["DELETE"])
def delete_recurring(item_id: str):
    with STORE_LOCK:
        store = read_store()
        items, _ = find_item(store, "recurring_by_user", item_id)
        deleted = items is not None
        if items is not None:
            items[:] = [item for item in items if str(item.get("id")) != item_id]
        if deleted:
            write_store(store)

    if not deleted:
        return jsonify({"error": "Recurring expense not found."}), 404
    return jsonify({"deleted": True, "id": item_id})


@app.route("/update_expense/<item_id>", methods=["PUT"])
def update_expense(item_id: str):
    payload = request.get_json(silent=True) or {}

    with STORE_LOCK:
        store = read_store()
        _, existing = find_item(store, "expenses_by_user", item_id)
        if existing is None:
            return jsonify({"error": "Expense not found."}), 404

        updated = normalize_expense({**existing, **payload}, item_id=item_id)
        existing.update(updated)
        write_store(store)

    return jsonify(existing)


@app.route("/delete_expense/<item_id>", methods=["DELETE"])
def delete_expense(item_id: str):
    with STORE_LOCK:
        store = read_store()
        items, _ = find_item(store, "expenses_by_user", item_id)
        deleted = items is not None
        if items is not None:
            items[:] = [item for item in items if str(item.get("id")) != item_id]
            write_store(store)

    if not deleted:
        return jsonify({"error": "Expense not found."}), 404
    return jsonify({"deleted": True, "id": item_id})


@app.route("/reset_user_data", methods=["POST"])
def reset_user_data():
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("user_id") or DEFAULT_USER_ID)

    with STORE_LOCK:
        store = read_store()
        store.setdefault("expenses_by_user", {})[user_id] = []
        store.setdefault("budgets_by_user", {})[user_id] = {"monthly": 5000}
        store.setdefault("recurring_by_user", {})[user_id] = []
        write_store(store)

    return jsonify({"reset": True, "user_id": user_id})


@app.route("/")
@app.route("/index.html")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/templates/<path:filename>")
def template_files(filename: str):
    return send_from_directory(TEMPLATES_DIR, filename)


@app.route("/css/<path:filename>")
def css_files(filename: str):
    return send_from_directory(CSS_DIR, filename)


@app.route("/js/<path:filename>")
def js_files(filename: str):
    return send_from_directory(JS_DIR, filename)


@app.route("/samples/<path:filename>")
def sample_files(filename: str):
    return send_from_directory(SAMPLES_DIR, filename)


if __name__ == "__main__":
    app.run(debug=True)
