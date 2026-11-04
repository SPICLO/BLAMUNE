/* BLAMUNE — vitrine : démo jouée, perle vivante, révélations au scroll. */

const basculeMouvement = window.matchMedia('(prefers-reduced-motion: reduce)');
const sansMouvement = basculeMouvement.matches;

/* ---------- Année ---------- */

const annee = document.getElementById('Annee');
if (annee) {
  annee.textContent = String(new Date().getFullYear());
}

/* ---------- En-tête : la nuit pose un fond dès qu'on décolle ---------- */

const entete = document.querySelector('.entete');
let enAttenteCadre = false;

function tourEntete() {
  if (entete) {
    entete.classList.toggle('visite', window.scrollY > 8);
  }
  enAttenteCadre = false;
}

window.addEventListener(
  'scroll',
  () => {
    if (!enAttenteCadre) {
      enAttenteCadre = true;
      window.requestAnimationFrame(tourEntete);
    }
  },
  { passive: true }
);
tourEntete();

/* ---------- Menu mobile ---------- */

const cassette = document.querySelector('.cassette-menu');
const menuMobile = document.querySelector('.menu-mobile');

if (cassette && menuMobile) {
  cassette.addEventListener('click', () => {
    const ouvert = menuMobile.classList.toggle('ouvert');
    cassette.setAttribute('aria-expanded', String(ouvert));
  });

  menuMobile.querySelectorAll('a').forEach((lien) => {
    lien.addEventListener('click', () => {
      menuMobile.classList.remove('ouvert');
      cassette.setAttribute('aria-expanded', 'false');
    });
  });
}

/* ---------- Révélations au scroll : une fois, avec un léger décalage ---------- */

const ciblesRevelation = [
  '.hero-titre',
  '.hero-acroche',
  '.hero-texte',
  '.hero-boutons',
  '.section-titre',
  '.section-texte',
  '.carnet',
  '.modes-paire',
  '.tchat',
  '.souvenirs',
  '.aube-titre',
  '.aube-ligne .bouton-fleuve'
];

const lignesOuvertes = ['.carnet-ligne', '.pratique-ligne'];

if (!sansMouvement) {
  document.querySelectorAll(lignesOuvertes.join(', ')).forEach((el) => {
    el.dataset.revelable = 'oui';
  });
}

const observateur =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entrees) => {
          entrees.forEach((entre) => {
            if (!entre.isIntersecting) return;
            entre.target.classList.add('posede');
            observateur.unobserve(entre.target);
          });
        },
        { once: true, rootMargin: '-60px 0px -10% 0px' }
      )
    : null;

function reveler(selecteur) {
  document.querySelectorAll(selecteur).forEach((el, index) => {
    if (observateur) {
      el.style.transitionDelay = `${Math.min(index * 60, 340)}ms`;
      observateur.observe(el);
      el.addEventListener(
        'transitionend',
        () => {
          el.style.transitionDelay = '';
        },
        { once: true }
      );
    } else {
      el.classList.add('posede');
    }
  });
}

document.querySelectorAll(ciblesRevelation.join(', ')).forEach((el) => {
  if (el.getBoundingClientRect().top < window.innerHeight * 0.98) {
    /* déjà dans la vue : l'entrée se joue sur deux cadres, sans dépendre de l'observateur */
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => el.classList.add('posede'))
    );
  } else if (observateur) {
    observateur.observe(el);
  } else {
    el.classList.add('posede');
  }
});

reveler('[data-revelable]');

/* ---------- La perle vit avec la démo ---------- */

const perle = document.getElementById('LaPerle');

function etatPerle(etat) {
  if (perle) {
    perle.setAttribute('data-etat', etat);
  }
}

/* ---------- La démo : une conversation sur le souvenir ---------- */

const fil = document.getElementById('FilDemo');
const pastilles = document.getElementById('Pastilles');
const modeleBulle = document.getElementById('ModeleBulle');

const CONVERSATION = [
  { role: 'bot', texte: 'Salut ! Ça fait plaisir de te revoir.' },
  { role: 'user', texte: 'Retiens que samedi, je courrai le 10 km de Dijon.' },
  {
    role: 'bot',
    texte: 'Noté ! Samedi, 10 km de Dijon. Je te souhaite bonne course vendredi soir.',
    note: 'samedi · 10 km de Dijon'
  },
  { role: 'user', texte: "Et mon café, tu t'en souviens ?" },
  {
    role: 'bot',
    texte: "Serré, dès le matin. Ça, je ne l'oublie pas.",
    note: 'le café serré'
  }
];

function attendre(ms) {
  return new Promise((reprise) => {
    window.setTimeout(reprise, ms);
  });
}

function attendreVisible() {
  return document.hidden
    ? new Promise((reprise) => {
        document.addEventListener('visibilitychange', reprise, { once: true });
      })
    : Promise.resolve();
}

function pauser(ms) {
  return attendreVisible().then(() => attendre(ms));
}

function bulleUtilisateur(commentaire) {
  const bulle = modeleBulle.content.firstElementChild.cloneNode(true);
  bulle.classList.add('bulle-user');
  bulle.querySelector('p').textContent = commentaire;
  fil.appendChild(bulle);
  window.requestAnimationFrame(() => bulle.classList.add('posede'));
  return bulle;
}

function bullePointes() {
  const pointes = document.createElement('div');
  pointes.className = 'bulle-pointes';
  pointes.setAttribute('aria-label', 'BLAMUNE écrit');
  for (let i = 0; i < 3; i += 1) {
    pointes.appendChild(document.createElement('span'));
  }
  fil.appendChild(pointes);
  return pointes;
}

function bulleBotAsync() {
  const bulle = modeleBulle.content.firstElementChild.cloneNode(true);
  bulle.classList.add('bulle-bot');
  const p = bulle.querySelector('p');
  return { bulle, p };
}

async function ecrireBot(texte) {
  etatPerle('reflechit');
  const pointes = bullePointes();
  await pauser(700);
  pointes.remove();
  etatPerle('ecrit');
  const { bulle, p } = bulleBotAsync();
  fil.appendChild(bulle);
  if (sansMouvement) {
    p.textContent = texte;
    bulle.classList.add('posede');
    await pauser(200);
  } else {
    bulle.classList.add('posede');
    await pauser(80);
    for (let i = 0; i < texte.length; i += 2) {
      p.textContent = texte.slice(0, i + 2);
      await pauser(26);
    }
    p.textContent = texte;
  }
  etatPerle('repos');
  return bulle;
}

function noter(textePastille) {
  if (!pastilles) return;
  const li = document.createElement('li');
  li.className = 'souvenir-pastille';
  li.textContent = textePastille;
  pastilles.appendChild(li);
  window.requestAnimationFrame(() => li.classList.add('posede'));
}

async function jouerConversation() {
  if (!fil || !pastilles || !modeleBulle || fil.dataset.joue) return;
  fil.dataset.joue = 'oui';
  await pauser(500);
  for (const tour of CONVERSATION) {
    if (tour.role === 'user') {
      bulleUtilisateur(tour.texte);
      await pauser(1050);
    } else {
      await ecrireBot(tour.texte);
      if (tour.note) {
        noter(tour.note);
        await pauser(1150);
      }
    }
  }
}

const tchat = document.querySelector('.tchat');
if (observateur && tchat) {
  const observeTchat = new IntersectionObserver(
    (entrees) => {
      entrees.forEach((entre) => {
        if (entre.isIntersecting) {
          jouerConversation();
          observeTchat.disconnect();
        }
      });
    },
    { once: true, rootMargin: '0px 0px -20% 0px' }
  );
  observeTchat.observe(tchat);
} else {
  jouerConversation();
}

/* ---------- Le carnet filtre pour de vrai ---------- */

const recherche = document.getElementById('RechercheCarnet');
const lignes = document.querySelectorAll('#LignesCarnet .carnet-ligne');

function sansAccent(texte) {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

if (recherche && lignes.length) {
  recherche.addEventListener('input', () => {
    const aiguille = sansAccent(recherche.value.trim());
    lignes.forEach((ligne) => {
      const trouve = sansAccent(ligne.textContent).includes(aiguille);
      ligne.classList.toggle('invisible-filtre', aiguille.length > 0 && !trouve);
    });
  });
}
