const suggestionList = document.querySelector("#suggestionList");

function render(state = {}) {
  const items = Array.isArray(state.items) ? state.items : [];
  const selectedIndex = Number(state.selectedIndex);
  suggestionList.replaceChildren();

  items.forEach((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `suggestion${index === selectedIndex ? " selected" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === selectedIndex));

    const icon = document.createElement("span");
    icon.className = `suggestion-icon ${entry.kind === "history" ? "history" : "search"}`;
    icon.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "suggestion-copy";
    const primary = document.createElement("strong");
    primary.textContent = entry.primary || "";
    const secondary = document.createElement("small");
    secondary.textContent = entry.secondary || "";
    copy.append(primary, secondary);
    button.append(icon, copy);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      window.minovaSuggestions.select(index);
    });
    suggestionList.appendChild(button);
  });

  suggestionList.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

window.minovaSuggestions.onState(render);
window.minovaSuggestions.getState().then(render);
