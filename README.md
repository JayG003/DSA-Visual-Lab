# DSA Visual Lab

A browser-based learning project for stepping through supported C snippets and inspecting simulated variables and arrays.

## Folder structure

```text
dsa_visual_lab_project/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── app.js
├── assets/
│   └── README.txt
└── README.md
```

## Where files go

- `index.html` — the webpage layout and the links to CSS/JavaScript.
- `css/style.css` — all page styling, including dark/light themes and responsive layout.
- `js/app.js` — editor behavior, parsing/simulation, memory rendering, terminal, iteration controls, and keyboard shortcuts.
- `assets/` — optional images/icons if you add them later.
- `README.md` — setup and project notes.

## Run it

1. Extract the ZIP file.
2. Open the `dsa_visual_lab_project` folder in VS Code.
3. Open `index.html` in a browser, or use VS Code Live Server.
4. If the browser blocks anything when opening the file directly, use Live Server.

## Important limitation

This is a client-side educational simulator, not a full C compiler. It supports only a subset of C syntax. Validate features against small sample programs before relying on the trace for complex code.
