// =====================================================================
//  Compteur d'octets sortants (bande passante egress)
// =====================================================================
//  Pourquoi : l'offre Hobby de Render plafonne a 5 Go de sortie/mois.
//  Au-dela, le workspace est SUSPENDU et le site tombe. Une fuite
//  inattendue (robot qui retelcharge tout en boucle, moniteur externe
//  sans cache, poller oublie) doit se VOIR dans /health avant la facture.
//
//  Ce qui est compte :
//   - Content-Length quand l'entete existe (JSON compresse : valeur
//     exacte, APRES compression) ;
//   - sinon la somme des fragments passes a res.write/res.end. Pour les
//     textes servis compres en streaming, cette somme est prise AVANT
//     compression : sur-estimation honnete, jamais decouverte tardive.
//
//  Familles : 'statique' (fichiers servis a l'URL directe), 'sse' (flux
//  text/event-stream), 'api' (le reste). 'top' : les chemins les plus
//  gourmands du jour, pour nommer le coupable sans attendre les logs.
//
//  Extrait de server.js. Aucune autre dependance : injectable et
//  testable isolement (horloge passee en parametre).
// =====================================================================
'use strict';

/** Cle du jour au format AAAA-MM-JJ (UTC, convention standard). */
function cleJour(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Taille d'un fragment d'ecriture : string utf8 ou Buffer. */
function octetsDe(c) {
  if (!c) return 0;
  if (Buffer.isBuffer(c)) return c.length;
  if (typeof c === 'string') return Buffer.byteLength(c);
  return 0;
}

function creerCompteurSortie({
  maintenant = () => Date.now(),
  maxChemins = 64, // garde-fou memoire : on ecrase le chemin le moins gros
  tailleTop = 5
} = {}) {
  // cle 'AAAA-MM-JJ' -> { total, statique, api, sse, chemins: Map }
  const jours = new Map();

  function jourCourant(cle) {
    let j = jours.get(cle);
    if (!j) {
      j = { total: 0, statique: 0, api: 0, sse: 0, chemins: new Map() };
      jours.set(cle, j);
      // Hygiene : le jour encore plus ancien que la veille s'efface.
      const hier = cleJour(maintenant() - 86400000);
      for (const k of Array.from(jours.keys())) {
        if (k !== cle && k !== hier) jours.delete(k);
      }
    }
    return j;
  }

  /** Sous-famille par defaut : fichier servi ou appel d'API. */
  function familleParDefaut(req) {
    const p = req.path || '';
    return p === '/' || /\.(html|css|js|mjs|ico|png|jpg|jpeg|svg|txt|xml|webmanifest)$/i.test(p)
      ? 'statique'
      : 'api';
  }

  function noter(j, fam, chemin, unis) {
    j.total += unis;
    j[fam] += unis;
    if (chemin) {
      if (j.chemins.size >= maxChemins && !j.chemins.has(chemin)) {
        const min = Array.from(j.chemins.entries()).reduce((a, b) => (b[1] < a[1] ? b : a));
        j.chemins.delete(min[0]);
      }
      j.chemins.set(chemin, (j.chemins.get(chemin) || 0) + unis);
    }
  }

  function middleware(req, res, next) {
    let octets = 0;
    const rWrite = res.write;
    const rEnd = res.end;
    res.write = function (c) {
      octets += octetsDe(c);
      return rWrite.apply(res, arguments);
    };
    res.end = function (c) {
      octets += octetsDe(c);
      return rEnd.apply(res, arguments);
    };
    res.on('finish', () => {
      try {
        const cle = cleJour(maintenant());
        const j = jourCourant(cle);
        // Content-Length definitif (JSON compresse) = mesure exacte
        // POST-compression, prioritaire sur la somme des fragments.
        const entete = res.getHeader ? res.getHeader('content-length') : null;
        const unis = entete != null && !Number.isNaN(Number(entete)) ? Number(entete) : octets;
        // SSE : un flux text/event-stream peut durer des heures et ne doit
        // pas se noyer dans 'api' (debit continu == suspect n.1).
        const ctype = String(res.getHeader ? res.getHeader('content-type') || '' : '');
        const fam = ctype.indexOf('text/event-stream') === 0 ? 'sse' : familleParDefaut(req);
        noter(j, fam, req.path || '', unis);
      } catch (e) {
        // Aucun echec de comptage ne doit casser une reponse partiante.
      }
    });
    if (typeof next === 'function') next();
  }

  /**
   * Valeur lisible par /health : aujourd'hui, hier, et le palmares.
   * Un champ hier permet de comparer d'un regard la croissance.
   */
  function etat() {
    const cle = cleJour(maintenant());
    const j = jours.get(cle);
    const hier = jours.get(cleJour(maintenant() - 86400000));
    const top = j
      ? Array.from(j.chemins.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, tailleTop)
      : [];
    return {
      jour: cle,
      total: j ? j.total : 0,
      statique: j ? j.statique : 0,
      api: j ? j.api : 0,
      sse: j ? j.sse : 0,
      hier: hier
        ? { total: hier.total, statique: hier.statique, api: hier.api, sse: hier.sse }
        : null,
      top
    };
  }

  return { middleware, etat };
}

module.exports = { creerCompteurSortie };
