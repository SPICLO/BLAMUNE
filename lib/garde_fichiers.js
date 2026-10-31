// =====================================================================
//  Garde de fichiers : plafond d'OCTETS par IP et par jour (UTC)
// =====================================================================
//  Pourquoi : une limite en requetes/min ne suffit pas a proteger un
//  quota de bande passante. Un client qui repete le meme fichier a la
//  frequence autorisee peut quand meme tirer des gigaoctets (120 requetes
//  sur une page de 30 Ko compressee = 2,4 Go/jour). La defense honnête :
//  compter les octets, plafonner largement au-dessus de l'usage humain
//  (60 Mo/jour = 800 chargements de page) mais quelques ordres de
//  grandeur sous un robot.
//
//  Vie privee : aucun identifiant d'IP n'est expose par /health. L'etat
//  public ne montre que le nombre d'IP surveillees et le plafond.
//
//  Extrait de server.js. Horloge injectee pour rester testable.
// =====================================================================
'use strict';

/** Cle du jour au format AAAA-MM-JJ (UTC). */
function cleJour(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function creerGardeFichiers({
  plafondOctets = 60 * 1024 * 1024, // 60 Mo/jour/IP (800 pages de 75 Ko)
  maintenant = () => Date.now(),
  maxIps = 500 // garde-fou memoire : la Map n'explose jamais
} = {}) {
  // ip -> { jour, octets }
  const parIp = new Map();

  function nettoyer(jour) {
    // Les entrees d'un jour passe ne servent plus a rien : jetees.
    for (const [ip, v] of Array.from(parIp)) {
      if (v.jour !== jour) parIp.delete(ip);
    }
    // Encore plein ? On jette la plus petite consommation pour laisser
    // la place aux nouveaux venus, sans jamais depasser maxIps entrees.
    while (parIp.size >= maxIps) {
      let plusPetite = null;
      for (const [ip, v] of parIp) {
        if (!plusPetite || v.octets < plusPetite[1].octets) plusPetite = [ip, v];
      }
      if (!plusPetite) break;
      parIp.delete(plusPetite[0]);
    }
  }

  /** Le service est-il encore permis pour cette IP aujourd'hui ? */
  function peutServir(ip) {
    const jour = cleJour(maintenant());
    const v = parIp.get(ip);
    if (!v || v.jour !== jour) return { refuse: false, octets: v ? v.octets : 0 };
    return { refuse: v.octets >= plafondOctets, octets: v.octets };
  }

  /** Compte les octets servis (apres la reponse, appelle au finish). */
  function noter(ip, octets) {
    if (!octets || octets <= 0) return;
    const jour = cleJour(maintenant());
    let v = parIp.get(ip);
    if (!v || v.jour !== jour) {
      nettoyer(jour); // opportune : reserve la place avant l'insertion
      v = { jour, octets: 0 };
    }
    v.octets += octets;
    parIp.set(ip, v);
  }

  /** Vue /health : jamais d'IP, seulement des grandeurs. */
  function etat() {
    const jour = cleJour(maintenant());
    let ips = 0;
    for (const v of parIp.values()) if (v.jour === jour) ips += 1;
    return { jour, plafondOctets, ips };
  }

  return { peutServir, noter, etat };
}

module.exports = { creerGardeFichiers };
