const grid = document.getElementById("projects-grid");
const count = document.getElementById("projects-count");
const year = document.getElementById("year");

if (year) {
  year.textContent = String(new Date().getFullYear());
}

if (Array.isArray(PROJETS) && grid) {
  count.textContent = String(PROJETS.length);

  PROJETS.forEach((projet) => {
    const card = document.createElement(projet.lien ? "a" : "article");
    card.className = "project-card";

    if (projet.lien) {
      card.href = projet.lien;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
    } else {
      card.setAttribute("aria-disabled", "true");
    }

    const content = document.createElement("div");
    content.className = "card-content";

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const numero = document.createElement("span");
    numero.className = "card-number";
    numero.textContent = projet.numero || "";

    const statut = document.createElement("span");
    statut.className = "card-status";
    if (projet.statut === "en ligne") {
      statut.classList.add("is-online");
      statut.textContent = "En ligne";
    } else if (projet.statut === "en atelier") {
      statut.textContent = "En atelier";
    } else {
      statut.classList.add("is-soon");
      statut.textContent = "À venir";
    }

    meta.appendChild(numero);
    meta.appendChild(statut);

    const main = document.createElement("div");
    main.className = "card-main";

    const titleGroup = document.createElement("div");
    titleGroup.className = "card-title-group";

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = projet.nom || "";

    const accroche = document.createElement("p");
    accroche.className = "card-accroche";
    accroche.textContent = projet.accroche || "";

    titleGroup.appendChild(title);
    titleGroup.appendChild(accroche);

    main.appendChild(titleGroup);

    const details = document.createElement("div");
    details.className = "card-details";

    const note = document.createElement("p");
    note.className = "card-note";
    note.textContent = projet.note || "";

    const tech = document.createElement("ul");
    tech.className = "card-tech";
    if (Array.isArray(projet.technique)) {
      projet.technique.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        tech.appendChild(li);
      });
    }

    details.appendChild(note);
    if (tech.children.length > 0) {
      details.appendChild(tech);
    }

    main.appendChild(details);

    const cta = document.createElement("div");
    cta.className = "card-cta";
    if (projet.lien) {
      cta.innerHTML =
        '<span>Visiter le projet</span><span class="card-cta-arrow"></span>';
    } else {
      cta.innerHTML =
        '<span>En préparation</span><span class="card-cta-arrow"></span>';
    }

    content.appendChild(meta);
    content.appendChild(main);
    content.appendChild(cta);
    card.appendChild(content);
    grid.appendChild(card);
  });
}
