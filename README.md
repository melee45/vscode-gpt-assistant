# GPT Assistant for VS Code

🚀 A lightweight GPT-powered coding assistant that brings suggestions, completions, and contextual insights directly into your VS Code workflow.

## ✨ Features

- 💬 **Ask GPT** about your selected code or entire file.
- 💡 **Inline Suggestions** with one-click insert (like Copilot).
- 📎 **CodeLens GPT Suggestions** at the top of each file.
- ⚡ **Auto-completions** powered by OpenAI with trigger on typing `.`

## 🧪 Usage

### 1. Install the Extension (Local Dev)
```bash
npm install
npm run compile
code .
```

### 2. Ask GPT
* Open a file.
* Run ```GPT Assistant: Ask``` from the command palette.
* Provide your question - the assistant will respond based on the code context.

### 3. Inline Suggestions
* Type in your editor, then pause.
* A GPT-generated suggestion will appear as inline decoration with ```[Insert]```.

### 3. CodeLens Suggestions
* At the top of each file, click ```Insert GPT Suggestion``` to insert the suggestion on line 1.

## ⚙️ Setup
Create a .env file in your root folder:
```bash
OPENAI_API_KEY=your-openai-api-key-here
```
## 🛠 Tech Stack
* VS Code Extension API
* OpenAI GPT
* TypeScript
* dotenv

## 📂 Project Structure
```pgsql
src/
  └─ extension.ts        # Main extension logic
  └─ gpt.ts              # GPT API call logic
.env
README.md
package.json
tsconfig.json
```

## 🧠 License
MIT
```yaml
---

## ✅ 2. `.gitignore`

Create a `.gitignore` file:

```gitignore
node_modules/
out/
dist/
.vscode/
.env
*.vsix
```
