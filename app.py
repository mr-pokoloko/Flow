import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
CSS_DIR = BASE_DIR / "css"
JS_DIR = BASE_DIR / "js"
SAMPLES_DIR = BASE_DIR / "samples"


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
