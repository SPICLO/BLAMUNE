 #include <iostream>
#include <string>
#include <fstream>
#include <vector>
#include <map>
#include <set>
#include <iterator>
#include <cctype>
#include <cstdlib>
#include <ctime>
#include <cstring>
#include <algorithm>
#include <sstream>
#include <climits>
#include <limits>
#ifdef _WIN32
#include <windows.h>
#endif

// Tirage aleatoire : choisit un index au hasard dans [0, nb).
// Utilise rand() (initialise par srand(time(0)) dans main()) pour un
// comportement imprevisible et humain.
int prochainIndice(int nb) {
    if (nb <= 0) return 0;
    return rand() % nb;
}

std::string minuscules(std::string s) {
    std::string r;
    for (unsigned int i = 0; i < s.size(); i++) r += std::tolower((unsigned char)s[i]);
    return r;
}

// Remplace les caracteres accentues (UTF-8) par leur equivalent sans accent,
// pour que "equipe", "equipe" et "equipe" soient compares de la meme facon.
std::string sansAccents(const std::string& s) {
    std::string r = s;
    static const char* src[] = {
        "\xC3\xA0","\xC3\xA2","\xC3\xA4","\xC3\xA6","\xC3\xA7",
        "\xC3\xA8","\xC3\xA9","\xC3\xAA","\xC3\xAB",
        "\xC3\xAE","\xC3\xAF",
        "\xC3\xB4","\xC3\xB6",
        "\xC3\xB9","\xC3\xBB","\xC3\xBC",
        "\xC5\x93",
        "\xC3\x80","\xC3\x82","\xC3\x84",
        "\xC3\x87",
        "\xC3\x88","\xC3\x89","\xC3\x8A","\xC3\x8B",
        "\xC3\x8E","\xC3\x8F",
        "\xC3\x94","\xC3\x96",
        "\xC3\x99","\xC3\x9B","\xC3\x9C",
        "\xC5\x92"
    };
    static const char* dst[] = {
        "a","a","a","ae","c",
        "e","e","e","e",
        "i","i",
        "o","o",
        "u","u","u",
        "oe",
        "A","A","A",
        "C",
        "E","E","E","E",
        "I","I",
        "O","O",
        "U","U","U",
        "OE"
    };
    for (int k = 0; k < 33; k++) {
        std::string::size_type pos = 0;
        while ((pos = r.find(src[k], pos)) != std::string::npos) {
            r.replace(pos, 2, dst[k]);
            pos += 1;
        }
    }
    // Accents encodés sur UN octet (console Windows : CP850, CP1252, Latin-1) :
    // savoir.txt est en UTF-8, mais l'utilisateur tape souvent dans une console
    // francaise. Sans cette passe, "temperature" ne matcherait pas "temperature".
    for (unsigned int k = 0; k < r.size(); k++) {
        unsigned char c = (unsigned char)r[k];
        // octets d'introduction UTF-8 (deja traits ci-dessus) : on les ignore
        if (c == 0xC2 || c == 0xC3 || c == 0xC5) continue;
        char remplace = 0;
        if (c >= 0xC0 && c <= 0xC5) remplace = 'A';
        else if (c == 0xC7) remplace = 'C';
        else if (c >= 0xC8 && c <= 0xCB) remplace = 'E';
        else if (c >= 0xCC && c <= 0xCF) remplace = 'I';
        else if (c == 0xD0) remplace = 'D';
        else if (c == 0xD1) remplace = 'N';
        else if (c >= 0xD2 && c <= 0xD6) remplace = 'O';
        else if (c == 0xD8) remplace = 'O';
        else if (c >= 0xD9 && c <= 0xDC) remplace = 'U';
        else if (c == 0xDD) remplace = 'Y';
        else if (c >= 0xE0 && c <= 0xE5) remplace = 'a';
        else if (c == 0xE7) remplace = 'c';
        else if (c >= 0xE8 && c <= 0xEB) remplace = 'e';
        else if (c >= 0xEC && c <= 0xEF) remplace = 'i';
        else if (c == 0xF0) remplace = 'd';
        else if (c == 0xF1) remplace = 'n';
        else if (c >= 0xF2 && c <= 0xF6) remplace = 'o';
        else if (c == 0xF8) remplace = 'o';
        else if (c >= 0xF9 && c <= 0xFC) remplace = 'u';
        else if (c == 0xFD) remplace = 'y';
        else if (c == 0xFF) remplace = 'y';
        // CP850 (console DOS francaise) : accents dans 0x80-0x9A
        else if (c == 0x81 || c == 0x9A) remplace = 'u';
        else if (c == 0x82) remplace = 'e';
        else if (c == 0x83 || c == 0x84) remplace = 'a';
        else if (c == 0x85) remplace = 'a';
        else if (c == 0x87) remplace = 'c';
        else if (c == 0x88 || c == 0x89 || c == 0x8A) remplace = 'e';
        else if (c == 0x8B || c == 0x8C || c == 0x8D) remplace = 'i';
        else if (c == 0x90) remplace = 'E';
        else if (c == 0x91 || c == 0x92) remplace = 'a';
        else if (c == 0x93 || c == 0x94 || c == 0x95) remplace = 'o';
        else if (c == 0x96 || c == 0x97) remplace = 'u';
        else if (c == 0x98) remplace = 'y';
        else if (c == 0x99) remplace = 'o';
        else if (c == 0x8E || c == 0x8F) remplace = 'A';
        if (remplace != 0) r[k] = remplace;
    }
    return r;
}

// L'utilisateur demande la bonne reponse du quiz en cours ?
bool demandeLaReponse(std::string p) {
    std::string pa = sansAccents(p);
    return pa.find("sais pas") != std::string::npos ||
           pa.find("jsp") != std::string::npos ||
           pa.find("aucune id") != std::string::npos ||
           pa.find("c'est quoi la reponse") != std::string::npos ||
           pa.find("c quoi la reponse") != std::string::npos ||
           pa.find("donne la reponse") != std::string::npos;
}

// La phrase est-elle une question factuelle sans reponse connue ("quelle est la
// capitale du japon ?", "qui est xavier ?") ? Dans ce cas, composer une phrase
// autour d'un theme sorti de son contexte donne une reponse absurde : on renvoie
// plutot vers l'apprentissage.
bool estQuestionFactuelle(const std::string& p) {
    std::string pa = sansAccents(minuscules(p));
    return pa.find("quelle est") != std::string::npos ||
           pa.find("quel est") != std::string::npos ||
           pa.find("qui est") != std::string::npos ||
           pa.find("ou se trouve") != std::string::npos ||
           pa.find("ou se situe") != std::string::npos ||
           pa.find("combien de") != std::string::npos ||
           pa.find("comment s'appelle") != std::string::npos ||
           pa.find("en quelle annee") != std::string::npos ||
           pa.find("c'est qui") != std::string::npos ||
           pa.find("c est qui") != std::string::npos ||
           pa.find("le sens de") != std::string::npos ||
           pa.find("la definition de") != std::string::npos ||
           pa.find("la signification de") != std::string::npos ||
           pa.find("qu'est-ce que c'est") != std::string::npos ||
           pa.find("qu est ce que c est") != std::string::npos ||
           pa.find("c'est quoi") != std::string::npos ||
           pa.find("c est quoi") != std::string::npos;
}

// La phrase contient-elle le mot en entier, sans qu'il soit cache dans un autre ?
// "oui" n'est pas dans "Louis", "pas" n'est pas dans "compas". L'apostrophe fait
// partie du mot ("j'aime" est un mot).
bool contientMot(const std::string& phrase, const std::string& motBrut) {
    std::string p = sansAccents(minuscules(phrase));
    std::string m = sansAccents(minuscules(motBrut));
    if (m.empty()) return false;
    std::string tok = "";
    for (unsigned int i = 0; i <= p.size(); i++) {
        char ch = (i < p.size()) ? p[i] : ' ';
        if ((ch >= 'a' && ch <= 'z') || ch == '\'') { tok += ch; continue; }
        if (tok == m) return true;
        tok = "";
    }
    return false;
}

// Reaction naturelle a la reponse de l'utilisateur (oui, non, autre...)
std::string reactionReponse(std::string p) {
    if (p.find("j'aime pas") != std::string::npos ||
        contientMot(p, "non") || contientMot(p, "nan") || contientMot(p, "pas") ||
        contientMot(p, "jamais")) {
        std::string r[] = {
            "D'accord, je note !", "Ok, je vois.", "Pas de souci, chacun ses gouts !",
            "C'est note, je retiens.", "Tant pis alors, c'est pas grave.",
            "Je comprends, c'est pas toujours facile.",
            "Hmm, c'est vrai que c'est pas pour tout le monde.",
            "Ok, pas de jugement. Chacun son truc.", "C'est bien de le dire franchement.",
            "Ok je vois, c'est pas ton delire.", "D'accord, je m'en souviens.",
            "Pas de probleme, je comprends."
        };
        return r[prochainIndice(12)];
    }
    if (contientMot(p, "oui") || contientMot(p, "ouais") || contientMot(p, "ouai") ||
        contientMot(p, "j'aime") || contientMot(p, "yes") || contientMot(p, "trop")) {
        std::string r[] = {
            "Ah cool !", "Trop bien ca.", "Ha ouais, chouette.",
            "ca fait plaisir de le savoir !", "Nice, j'aime ca.",
            "Cool, on est d'accord la�-dessus.", "Super, je m'en souviens.",
            "Chouette, t'as bon goat!", "Ouais, c'est vrai que c'est bien.",
            "Ok top, je retiens ca.", "Ha bah c'est bien ca.",
            "Ah oui ? Trop bien alors !"
        };
        return r[prochainIndice(12)];
    }
    std::string r[] = {
        "Hmm, je vois ce que tu veux dire.", "C'est vrai ca, interessant.",
        "Ok je retiens.", "Ha interessant dis donc.", "C'est bien de me le dire.",
        "Je m'en souviendrai.", "Ok, c'est note.", "D'accord, je vois.",
        "C'est cool que tu me dises ca.", "Je vois, c'est bien à savoir.",
        "Hmm, j'aime bien que tu sois franc.", "Ok, je comprends mieux."
    };
    return r[prochainIndice(12)];
}

// Est-ce un simple mot d'acquiescement ou de refus ("oui", "non", "ok"...) ?
// L'IA accuse reception au lieu de composer une phrase hors-sujet (elle ne
// doit pas parler toute seule de sujets que l'utilisateur n'a pas abordes).
bool estSimpleAcquiescement(const std::string& p) {
    std::string n = p;
    while (!n.empty() && (n[n.size() - 1] == '.' || n[n.size() - 1] == '!' ||
                          n[n.size() - 1] == '?' || n[n.size() - 1] == ','))
        n.erase(n.size() - 1);
    return n == "oui" || n == "ouais" || n == "ouai" || n == "ok" ||
           n == "non" || n == "nan" || n == "d'accord" || n == "d accord" ||
           n == "peut-etre" || n == "peut etre" ||
           n == "bof" || n == "si" || n == "yes";
}

// Retourne le premier nombre trouve dans la phrase ("" si aucun).
// "j'ai 25 ans" -> "25", "il y a 3 chiens" -> "3".
std::string extraireNombre(const std::string& s) {
    for (unsigned int i = 0; i < s.size(); i++) {
        if (s[i] >= '0' && s[i] <= '9') {
            std::string nb;
            while (i < s.size() && s[i] >= '0' && s[i] <= '9') { nb += s[i]; i++; }
            return nb;
        }
    }
    return "";
}

// "j'ai 25 ans", "25 ans" ou juste "25" : l'utilisateur donne-t-il son age ?
// Seul un nombre suivi de "ans" ou isole est accepte ("j'ai 2 freres" et
// "dans 10 minutes" ne comptent pas comme un age).
bool estUnAge(const std::string& p, std::string& nb) {
    // On cherche un nombre suivi du mot "ans" (ou un nombre isole en fin de
    // phrase). L'ancien code ne testait que le PREMIER nombre de la phrase :
    // "j'ai 2 chiens et 30 ans" ne revelait jamais l'age (le "2" bloquait).
    for (unsigned int i = 0; i < p.size(); i++) {
        if (p[i] < '0' || p[i] > '9') continue;
        unsigned int j = i;
        while (j < p.size() && p[j] >= '0' && p[j] <= '9') j++;
        std::string candidat = p.substr(i, j - i);
        unsigned int k = j;
        while (k < p.size() && (p[k] == ' ' || p[k] == ',')) k++;
        std::string reste = p.substr(k);
        if (reste.compare(0, 3, "ans") == 0 && (reste.size() == 3 || reste[3] == ' ' || reste[3] == '.' || reste[3] == '!' || reste[3] == '?' || reste[3] == ',')) { nb = candidat; return true; }
        // nombre isole en fin de phrase : "25", "25.", "25 !"...
        bool finPhrase = true;
        for (unsigned int m = k; m < p.size() && finPhrase; m++) {
            char c = p[m];
            if (!(c == ' ' || c == '.' || c == '!' || c == '?' || c == ',')) finPhrase = false;
        }
        if (finPhrase) { nb = candidat; return true; }
        i = j;
    }
    return false;
}

// ============ COMPRENDRE LES EMOTIONS ET LES ETATS ============
// Retourne une categorie emotionnelle ("joie", "tristesse", "colere",
// "peur", "fatigue", "malade") ou "" si la phrase n'exprime pas d'etat.
// On compare sans accents pour reconnaitre "fatigue" comme "fatigue".
std::string detecterEtat(const std::string& p) {
    std::string pa = sansAccents(minuscules(p));
    // joie
    if (pa.find("trop bien") != std::string::npos ||
        pa.find("c'est super") != std::string::npos ||
        pa.find("c est super") != std::string::npos ||
        pa.find("ca va bien") != std::string::npos ||
        pa.find("je vais bien") != std::string::npos ||
        pa.find("je me sens bien") != std::string::npos ||
        pa.find("j'adore") != std::string::npos ||
        pa.find("j adore") != std::string::npos ||
        pa.find("c'est genial") != std::string::npos ||
        pa.find("c est genial") != std::string::npos ||
        pa.find("c'est top") != std::string::npos ||
        pa.find("c'est cool") != std::string::npos ||
        pa.find("ca fait plaisir") != std::string::npos ||
        pa.find("je suis content") != std::string::npos ||
        pa.find("j'ai la peche") != std::string::npos ||
        pa.find("j ai la peche") != std::string::npos ||
        contientMot(pa, "content") || contientMot(pa, "contente") ||
        contientMot(pa, "heureux") || contientMot(pa, "heureuse") ||
        contientMot(pa, "ravi") || contientMot(pa, "ravie") ||
        contientMot(pa, "super") || contientMot(pa, "genial") ||
        contientMot(pa, "excellent") || contientMot(pa, "parfait") ||
        contientMot(pa, "amoureux") || contientMot(pa, "amoureuse") ||
        contientMot(pa, "fier") || contientMot(pa, "fiere") ||
        contientMot(pa, "ebloui") || contientMot(pa, "eblouie") ||
        contientMot(pa, "enthousiaste") || contientMot(pa, "excite") ||
        contientMot(pa, "excitee") || contientMot(pa, "determine") ||
        contientMot(pa, "determinee") || contientMot(pa, "motiv"))
        return "joie";
    // tristesse
    if (pa.find("ca va pas") != std::string::npos ||
        pa.find("ca va mal") != std::string::npos ||
        pa.find("je vais mal") != std::string::npos ||
        pa.find("je me sens mal") != std::string::npos ||
        pa.find("je me sens seul") != std::string::npos ||
        pa.find("je me sens seule") != std::string::npos ||
        pa.find("je pleure") != std::string::npos ||
        pa.find("je suis mal") != std::string::npos ||
        pa.find("ca va pas du tout") != std::string::npos ||
        pa.find("j'ai les boules") != std::string::npos ||
        pa.find("j ai les boules") != std::string::npos ||
        pa.find("ca me manque") != std::string::npos ||
        contientMot(pa, "triste") || contientMot(pa, "tristesse") ||
        contientMot(pa, "malheureux") || contientMot(pa, "malheureuse") ||
        contientMot(pa, "decu") || contientMot(pa, "decue") ||
        contientMot(pa, "deprime") || contientMot(pa, "deprimee") ||
        contientMot(pa, "chagrin") || contientMot(pa, "peine") ||
        contientMot(pa, "melancolique") || contientMot(pa, "navre") ||
        contientMot(pa, "navree") || contientMot(pa, "desole") ||
        contientMot(pa, "desolee") || contientMot(pa, "abattu") ||
        contientMot(pa, "abattue") || contientMot(pa, "vulnerable"))
        return "tristesse";
    // colere
    if (pa.find("en colere") != std::string::npos ||
        pa.find("ca m'enerve") != std::string::npos ||
        pa.find("ca m agace") != std::string::npos ||
        pa.find("j'en ai marre") != std::string::npos ||
        pa.find("ca me saoule") != std::string::npos ||
        pa.find("c'est n'importe quoi") != std::string::npos ||
        contientMot(pa, "fache") || contientMot(pa, "fachee") ||
        contientMot(pa, "enerve") || contientMot(pa, "enervee") ||
        contientMot(pa, "agace") || contientMot(pa, "agacee") ||
        contientMot(pa, "furieux") || contientMot(pa, "furieuse") ||
        contientMot(pa, "excede") || contientMot(pa, "excedee") ||
        contientMot(pa, "insupporte") || contientMot(pa, "scandalise") ||
        contientMot(pa, "revolte") || contientMot(pa, "hargneux"))
        return "colere";
    // peur
    if (pa.find("j'ai peur") != std::string::npos ||
        pa.find("j ai peur") != std::string::npos ||
        pa.find("ca me fait peur") != std::string::npos ||
        pa.find("ca me fait flipper") != std::string::npos ||
        pa.find("j'ai trop peur") != std::string::npos ||
        pa.find("j'ai la frousse") != std::string::npos ||
        contientMot(pa, "angoisse") || contientMot(pa, "angoissee") ||
        contientMot(pa, "stresse") || contientMot(pa, "stressee") ||
        contientMot(pa, "inquiet") || contientMot(pa, "inquiete") ||
        contientMot(pa, "panique") || contientMot(pa, "effraye") ||
        contientMot(pa, "effrayee") || contientMot(pa, "terrifie") ||
        contientMot(pa, "terrifiee") || contientMot(pa, "phobique"))
        return "peur";
    // fatigue
    if (pa.find("je tombe de sommeil") != std::string::npos ||
        pa.find("j'ai sommeil") != std::string::npos ||
        pa.find("j ai sommeil") != std::string::npos ||
        pa.find("je suis creve") != std::string::npos ||
        pa.find("je suis creeve") != std::string::npos ||
        pa.find("j'en peux plus") != std::string::npos ||
        pa.find("j en peux plus") != std::string::npos ||
        contientMot(pa, "fatigue") || contientMot(pa, "fatiguee") ||
        contientMot(pa, "epuise") || contientMot(pa, "epuisee") ||
        contientMot(pa, "creve") || contientMot(pa, "creeve") ||
        contientMot(pa, "vss") || contientMot(pa, "faible") ||
        contientMot(pa, "essouffle") || contientMot(pa, "lourd") ||
        contientMot(pa, "ronchon") || contientMot(pa, "dormir"))
        return "fatigue";
    // malade / douleur
    if (pa.find("j'ai mal") != std::string::npos ||
        pa.find("j ai mal") != std::string::npos ||
        pa.find("j'ai le bobo") != std::string::npos ||
        contientMot(pa, "malade") || contientMot(pa, "douleur") ||
        contientMot(pa, "blesse") || contientMot(pa, "blessee") ||
        contientMot(pa, "fievre") || contientMot(pa, "fievreux") ||
        contientMot(pa, "mal") || contientMot(pa, "maux") || contientMot(pa, "tete"))
        return "malade";
    // ennui
    if (pa.find("je m'ennuie") != std::string::npos ||
        pa.find("je m ennuie") != std::string::npos ||
        pa.find("c'est ennuyeux") != std::string::npos ||
        pa.find("y'a rien a faire") != std::string::npos ||
        contientMot(pa, "ennui") || contientMot(pa, "ennuyeux") ||
        contientMot(pa, "lassant") || contientMot(pa, "barbant") ||
        contientMot(pa, "rasoir"))
        return "ennui";
    // surprise
    if (pa.find("oh la la") != std::string::npos ||
        pa.find("oh bon sang") != std::string::npos ||
        pa.find("sans blague") != std::string::npos ||
        contientMot(pa, "surpris") || contientMot(pa, "surprise") ||
        contientMot(pa, "stupfait") || contientMot(pa, "impressionne") ||
        contientMot(pa, "impressionnee") || contientMot(pa, "choque") ||
        contientMot(pa, "choquee"))
        return "surprise";
    return "";
}

// Reponse humaine a l'etat de l'utilisateur (varie a chaque fois).
// Le bot reagit avec empathie, ne repete pas toujours la meme formule,
// et adapte son ton a l'intensite ressentie.
std::string reactionEtat(const std::string& etat) {
    if (etat == "joie") {
        std::string r[] = {
            "Oh ca fait trop plaisir de te voir comme ca ! Raconte !",
            "Yess, ta bonne humeur est contagieuse ca se voit !",
            "J'adore quand t'es comme ca, ca fait du bien.",
            "T'as l'air vraiment content dis donc, je suis content pour toi !",
            "ca fait plaisir à lire franchement. Qu'est-ce qui t'a mis dans cet etat ?",
            "Ha oui, ca se sent, t'es en forme aujourd'hui !",
            "Cool cool, moi aussi ca me rend heureux de te savoir bien.",
            "C'est trop bien quand ca va bien, profite à fond !",
            "J'aime bien voir des gens heureux, c'est rassurant.",
            "T'as un sourire en ce moment je le sens ? Continue comme ca !"
        };
        return r[prochainIndice(10)];
    }
    if (etat == "tristesse") {
        std::string r[] = {
            "Oh non... Qu'est-ce qui se passe ? Je suis là.",
            "ca va pas, hein ? Vas-y, parle-moi, ca fait du bien de vider son sac.",
            "Je sens que t'es pas bien. C'est normal de pas toujours aller bien, tu sais.",
            "Mec... Dis-moi ce qui t'arrive, je t'ecoute sans te juger.",
            "C'est dur parfois. Mais t'es pas tout seul là-dedans, je suis là.",
            "Oh, ca me fait de la peine de te savoir comme ca. Raconte.",
            "Prends le temps qu'il te faut. Moi je suis là, ca change pas.",
            "Personne devrait se sentir comme ca. Dis-moi ce qui se passe.",
            "Hey... Viens, on en parle ? ca va pas toujours, et c'est okay.",
            "ca me touche que tu te confies. Je suis là pour ecouter, vraiment."
        };
        return r[prochainIndice(10)];
    }
    if (etat == "colere") {
        std::string r[] = {
            "Woah, calme-toi deux secondes. Respire un bon coup. Qu'est-ce qui t'est arriver ?",
            "Ok ok, je sens que t'es venere. Vas-y, vide ton sac, je t'ecoute.",
            "Hmmm, ca a l'air vraiment enervant dis donc. Raconte.",
            "Respire 4 secondes, expire 6. Et apres tu me racontes.",
            "Je comprends que t'es en colere, c'est legitime. Dis-moi tout.",
            "ca doit etre frustrant... Dis-moi ce qui t'a mis dans cet etat.",
            "Ok, t'as le droit d'etre venere. C'est normal. Vide ton sac.",
            "Je sens que t'as besoin de parler, vas-y, je t'ecoute.",
            "ca a l'air relou... Raconte, ca fait du bien de se plaindre parfois.",
            "Courage, ca va passer. Mais en attendant, dis-moi tout."
        };
        return r[prochainIndice(10)];
    }
    if (etat == "peur") {
        std::string r[] = {
            "Hey, pas de panique. Je suis la�. Qu'est-ce qui se passe ?",
            "Calme-toi, respire. On va trouver une solution ensemble.",
            "T'as peur de quoi exactement ? Dis-moi, ca va aller.",
            "Je comprends que t'es inquiet. Mais tu vas y arriver, j'en suis sur.",
            "Reste calme, respire profondement. Moi je suis la� pour t'ecouter.",
            "La peur c'est normal, ca veut dire que t'es conscient des choses. C'est bien.",
            "Ok, dis-moi ce qui t'effraie. Parler ca aide, promis.",
            "T'inquiete, je suis pas en train de te juger. Dis-moi ce qui te fait peur.",
            "Hmmm, c'est stressant... Mais tu vas te en sortir, j'y crois.",
            "Respire, tout va bien se passer. Dis-moi ce qui t'inquiete."
        };
        return r[prochainIndice(10)];
    }
    if (etat == "fatigue") {
        std::string r[] = {
            "T'as l'air crever dis donc. Tu dors pas assez ?",
            "Repose-toi un peu, tu le merites franchement.",
            "Une bonne nuit de sommeil et c'est reparti ! Tu fais quoi ce soir ?",
            "C'est normal d'etre fatigue, la vie c'est fatigant parfois.",
            "Prends soin de toi hein, c'est le plus important.",
            "Hmmm, repos necessaire ? Tu devrais t'accorder une pause.",
            "T'es pas une machine, repose-toi un peu !",
            "ca va aller, mais aujourd'hui c'est repos hein.",
            "Fatigue c'est humain. Demain c'est un autre jour.",
            "Je sens que t'es lessive. Essaie de te reposer un peu."
        };
        return r[prochainIndice(10)];
    }
    // malade / douleur
    std::string rM[] = {
        "Oh non, t'es malade ? Soigne-toi bien hein !",
        "Pas de bol... Prends soin de toi et repose-toi bien.",
        "J'espere que ca va vite passer. Bois de l'eau et repose-toi !",
        "Tu devrais consulter si ca dure hein, c'est important.",
        "Courage, les microbes ca finit toujours par passer !",
        "Mince... Dis-moi ou t'as mal, je peux au moins ecouter.",
        "ca doit etre relou... Repose-toi bien, je reviens demain.",
        "Prends soin de toi, c'est le plus important.",
        "Force a toi, c'est pas easy d'etre malade.",
        "Repose-toi bien, et reviens me voir quand tu te sens mieux."
    };
    // ennui
    if (etat == "ennui") {
        std::string rE[] = {
            "T'ennuies ? Raconte-moi ce que tu fais d'habitude, on va trouver un sujet.",
            "Allez, on va s'occuper ! Qu'est-ce qui te ferait plaisir la� ?",
            "L'ennui c'est le pire... Dis-moi un truc marrant que t'as fait.",
            "On pourrait parler de tout et de rien, ca te dit ?",
            "Tu t'ennuies ? Et si tu me racontes ta journee ?",
            "Je suis la� pour t'occuper ! Pose-moi une question ou raconte-moi un truc.",
            "L'ennui c'est passage. Qu'est-ce que tu aimerais faire la� ?",
            "Tu veux qu'on parle de quelque chose de passionnant ?",
            "L'ennui c'est l'ennemi ! On fait quelque chose d'interessant ?",
            "Et si on inventait un jeu ensemble ? Raconte-moi un truc marrant."
        };
        return rE[prochainIndice(10)];
    }
    // surprise
    if (etat == "surprise") {
        std::string rS[] = {
            "Woah, qu'est-ce qui t'a surpris comme ca ?",
            "Oh la la, t'as l'air impressionne ! Raconte !",
            "C'est fou non ? Dis-moi ce qui t'a marque.",
            "Je vois que t'es sur le cul ! Qu'est-ce qui s'est passer ?",
            "Oh, ca a l'air dingue ! Raconte-moi tout.",
            "T'as pas l'air de croire ce que tu viens de dire ! C'est quoi ?",
            "ca m'intrigue trop, dis-moi ce qui t'a surpris !",
            "Woah, ca a l'air incroyable ! Qu'est-ce qui s'est passer ?",
            "On dirait que t'es sous le choc ! Raconte-moi.",
            "Le shocking ! Qu'est-ce qui t'a mis dans cet etat ?"
        };
        return rS[prochainIndice(10)];
    }
    return rM[prochainIndice(10)];
}

// Retire un article en tete d'un nom ("le foot" -> "foot").
std::string retirerArticle(std::string s) {
    static const char* articles[] = { "un ", "une ", "le ", "la ", "les ", "des ", "du ", "de " };
    for (int a = 0; a < 8; a++) {
        std::size_t la = std::strlen(articles[a]);
        if (s.compare(0, la, articles[a]) == 0) { s.erase(0, la); break; }
    }
    while (!s.empty() && s[0] == ' ') s.erase(0, 1);
    return s;
}

// Detecte une phrase-definition que le bot peut apprendre tout seul :
//   "tokyo c'est la capitale du japon"   -> cle "tokyo", def "c'est la capitale du japon"
//   "paris est la capitale de la france" -> cle "paris", def "est la capitale de la france"
//   "un robot veut dire une machine"     -> cle "un robot", def "veut dire une machine"
// Retourne false si ce n'est pas une definition propre a retenir.
bool extraireDefinition(std::string p, std::string& cle, std::string& def) {
    std::string marqueur;
    std::size_t pos = p.find(" c'est ");
    if (pos != std::string::npos) marqueur = " c'est ";
    if (marqueur.empty()) { pos = p.find(" c est "); if (pos != std::string::npos) marqueur = " c est "; }
    if (marqueur.empty()) { pos = p.find(" veut dire "); if (pos != std::string::npos) marqueur = " veut dire "; }
    if (marqueur.empty()) { pos = p.find(" signifie "); if (pos != std::string::npos) marqueur = " signifie "; }
    if (marqueur.empty()) { pos = p.find(" est "); if (pos != std::string::npos) marqueur = " est "; }
    if (marqueur.empty()) return false;

    cle = p.substr(0, pos);
    std::string defSansMarqueur = p.substr(pos + marqueur.size());
    while (!cle.empty() && cle[0] == ' ') cle.erase(0, 1);
    while (!cle.empty() && cle[cle.size() - 1] == ' ') cle.erase(cle.size() - 1);
    while (!defSansMarqueur.empty() && defSansMarqueur[0] == ' ') defSansMarqueur.erase(0, 1);
    while (!defSansMarqueur.empty() && defSansMarqueur[defSansMarqueur.size() - 1] == ' ') defSansMarqueur.erase(defSansMarqueur.size() - 1);
    if (cle.size() < 3 || cle.size() > 50 || defSansMarqueur.size() < 4 || defSansMarqueur.size() > 100) return false;

    // un article en tete rend le mot-cle difficile a retrouver ensuite
    // ("un yakuzu" n'apparait pas dans "le yakuzu..." apres apprentissage) :
    // "un robot" -> "robot", "la lune" -> "lune".
    static const char* articles[] = { "un ", "une ", "le ", "la ", "les ", "des ", "du ", "de " };
    for (int a = 0; a < 8; a++) {
        std::size_t la = std::strlen(articles[a]);
        if (cle.compare(0, la, articles[a]) == 0) { cle.erase(0, la); break; }
    }
    while (!cle.empty() && cle[0] == ' ') cle.erase(0, 1);

    // le sujet ne doit pas etre une personne, un pronom ou un mot de liaison
    std::string premier = cle;
    for (unsigned int i = 0; i < cle.size(); i++) {
        if (cle[i] == ' ') { premier = cle.substr(0, i); break; }
    }
    static const char* exclus[] = {
        "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
        "ca", "c", "ce", "cela", "celui", "celle", "cette", "cet", "ces", "ceci",
        "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
        "notre", "nos", "votre", "vos", "leur", "leurs",
        "tout", "tous", "rien", "chacun",
        "quand", "si", "que", "qui", "quoi", "comment", "pourquoi",
        "qu'est", "quest", "et", "ou", "mais", "donc", "or", "ni", "car",
        "pour", "par", "sur", "avec", "sans", "dans", "a", "en", "de",
        "quel", "quelle", "quels", "quelles", "combien",
        0
    };
    for (int i = 0; exclus[i] != 0; i++) {
        if (premier == exclus[i]) return false;
    }

    // la definition ne doit pas etre un simple avis ("est trop bien", "c'est super"...)
    std::string mot = defSansMarqueur;
    for (unsigned int i = 0; i < defSansMarqueur.size(); i++) {
        if (defSansMarqueur[i] == ' ') { mot = defSansMarqueur.substr(0, i); break; }
    }
    static const char* avis[] = {
        "pas", "super", "trop", "bien", "nul", "genial",
        "cool", "mieux", "moche", "beau", "belle", "bon", "bonne", "mauvais",
        "facile", "difficile", "sympa", "top",
        0
    };
    for (int i = 0; avis[i] != 0; i++) {
        if (mot == avis[i]) return false;
    }

    // reconstruire la definition complete (avec le marqueur) a retenir
    def = marqueur + defSansMarqueur;
    while (!def.empty() && def[0] == ' ') def.erase(0, 1);
    while (!def.empty() && def[def.size() - 1] == ' ') def.erase(def.size() - 1);
    return true;
}

// ============ TOLERANCE AUX FAUTES D'ORTHOGRAPHE ============

// Verifie si un mot est un adjectif ou une emotion (pour eviter les faux positifs
// dans l'apprentissage du metier : "je suis fatigue" ne doit pas etre un metier).
bool estAdjectifOuEmotion(const std::string& mot) {
    std::string m = sansAccents(minuscules(mot));
    static const char* adjectifs[] = {
        "fatigue", "fatiguee", "epuise", "epuisee", "creve", "creeve",
        "heureux", "heureuse", "content", "contente", "ravi", "ravie",
        "triste", "malheureux", "malheureuse", "deprime", "deprimee",
        "fache", "fachee", "enerve", "enervee", "furieux", "furieuse",
        "inquiet", "inquiete", "stresse", "stressee", "angoisse",
        "panique", "effraye", "effrayee", "terrifie", "terrifiee",
        "malade", "blesse", "blessee", "mieux", "biens",
        "grand", "grande", "petit", "petite", "gros", "grosse",
        "bon", "bonne", "mauvais", "mauvaise", "vieux", "vieille",
        "jeune", "nouveau", "nouvelle", "dernier", "derniere",
        "seul", "seule", "ensemble",
        "ici", "la", "maintenant", "toujours", "jamais", "souvent",
        "bien", "mal", "vite", "lentement", "beaucoup", "peu",
        "tout", "tous", "toute", "toutes", "rien", "personne",
        "quelqu'un", "autre", "meme", "la-bas",
        "oui", "non", "ok", "bof", "super", "genial", "nul",
        "pire", "meilleur", "meilleure"
    };
    for (int i = 0; i < (int)(sizeof(adjectifs) / sizeof(adjectifs[0])); i++) {
        if (m == adjectifs[i]) return true;
    }
    return false;
}

// Distance de Levenshtein entre deux mots (nombre minimal de changements :
// insertion, suppression, substitution, transposition).
int distanceEdit(const std::string& a, const std::string& b) {
    int n = (int)a.size(), m = (int)b.size();
    if (n == 0) return m;
    if (m == 0) return n;
    std::vector< std::vector<int> > dp(n + 1, std::vector<int>(m + 1, 0));
    for (int i = 0; i <= n; i++) dp[i][0] = i;
    for (int j = 0; j <= m; j++) dp[0][j] = j;
    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            int cout = (a[i - 1] == b[j - 1]) ? 0 : 1;
            int mini = dp[i - 1][j] + 1;
            int candidat = dp[i][j - 1] + 1;
            if (candidat < mini) mini = candidat;
            candidat = dp[i - 1][j - 1] + cout;
            if (candidat < mini) mini = candidat;
            if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
                candidat = dp[i - 2][j - 2] + 1;
                if (candidat < mini) mini = candidat;
            }
            dp[i][j] = mini;
        }
    }
    return dp[n][m];
}

// Un mot de la phrase est-il assez proche du mot-cle pour etre accepte ?
// Gere les fautes d'orthographe courantes : lettres doubledes, voyelles
// substituees, consonnes proches, et fautes de frappe.
bool motsProches(const std::string& motBrut, const std::string& cibleBrute) {
    std::string mot = sansAccents(motBrut), cible = sansAccents(cibleBrute);
    if (mot == cible) return true;

    // Mots tres courts (< 3 lettres) : match exact uniquement
    if (mot.size() < 3 || cible.size() < 3) return mot == cible;

    // "course" ne doit pas matcher "courses" (ni "reseau" -> "reseaux") :
    // un mot de la phrase et un mot-cle ne doivent pas etre seulement
    // singulier/pluriel l'un de l'autre (sinon les 2 definitions s'embrouillent).
    if (mot.size() + 1 == cible.size() &&
        (cible[cible.size() - 1] == 's' || cible[cible.size() - 1] == 'x') &&
        mot == cible.substr(0, cible.size() - 1)) return false;

    // Seuil adapte selon la longueur du mot
    int minLen = std::min(mot.size(), cible.size());
    int maxLen = std::max(mot.size(), cible.size());

    // Les mots tres differents en longueur ne matchent pas
    if (maxLen > minLen * 2) return false;

    int seuil;
    if (minLen <= 4) seuil = 0;
    else if (minLen <= 6) seuil = 1;
    else if (minLen <= 9) seuil = 2;
    else seuil = 3;

    // Distance standard
    int dist = distanceEdit(mot, cible);
    if (dist <= seuil) return true;

    // Verification des fautes courantes :
    // 1. Lettres doubledes (comunication -> communication)
    if (dist > seuil && mot.size() < cible.size()) {
        std::string sansDoublons = "";
        for (unsigned int i = 0; i < mot.size(); i++) {
            if (sansDoublons.empty() || mot[i] != sansDoublons[sansDoublons.size()-1])
                sansDoublons += mot[i];
        }
        if (sansDoublons.size() < mot.size()) {
            int distDoublons = distanceEdit(sansDoublons, cible);
            if (distDoublons <= seuil) return true;
        }
    }

    // 2. Voyelles substituees (e/a/i/o/u interchangeables dans certaines fautes)
    // "musique" vs "musiqe" (voyelle manquante)
    // Attention : "foot" vs "fete" ne doit PAS matcher (squelettes consonnes "ft" == "ft")
    if (dist > seuil && abs((int)mot.size() - (int)cible.size()) <= 2) {
        // Verifier si la difference est surtout des voyelles
        std::string motSansVoyelles = "", cibleSansVoyelles = "";
        for (unsigned int i = 0; i < mot.size(); i++)
            if (mot[i] != 'a' && mot[i] != 'e' && mot[i] != 'i' && mot[i] != 'o' && mot[i] != 'u' && mot[i] != 'y')
                motSansVoyelles += mot[i];
        for (unsigned int i = 0; i < cible.size(); i++)
            if (cible[i] != 'a' && cible[i] != 'e' && cible[i] != 'i' && cible[i] != 'o' && cible[i] != 'u' && cible[i] != 'y')
                cibleSansVoyelles += cible[i];
        // Le squelette consonnes doit faire au moins 3 lettres pour etre significatif
        if (motSansVoyelles.size() >= 3 && cibleSansVoyelles.size() >= 3 && motSansVoyelles == cibleSansVoyelles) return true;
    }

    // 3. Consonnes proches (ph/f, s/ss, c/k, th/t)
    std::string motPhon = mot, ciblePhon = cible;
    // Remplacer ph par f
    std::string tmp = "";
    for (unsigned int i = 0; i < motPhon.size(); i++) {
        if (motPhon[i] == 'p' && i + 1 < motPhon.size() && motPhon[i+1] == 'h') { tmp += 'f'; i++; }
        else tmp += motPhon[i];
    }
    motPhon = tmp;
    tmp = "";
    for (unsigned int i = 0; i < ciblePhon.size(); i++) {
        if (ciblePhon[i] == 'p' && i + 1 < ciblePhon.size() && ciblePhon[i+1] == 'h') { tmp += 'f'; i++; }
        else tmp += ciblePhon[i];
    }
    ciblePhon = tmp;
    if (motPhon == ciblePhon) return true;
    if (distanceEdit(motPhon, ciblePhon) <= seuil) return true;

    return false;
}

// La reponse de l'utilisateur est-elle proche de la bonne reponse du quiz ?
// On compare les mots importants (au moins 4 lettres) : si un mot important de
// la bonne reponse apparait dans la phrase (ou avec une faute d'orthographe),
// on considere la reponse comme correcte. Sinon, ce n'est pas la bonne reponse.
bool reponseProche(const std::string& phrase, const std::string& correcte) {
    std::string p = sansAccents(minuscules(phrase));
    std::string c = sansAccents(minuscules(correcte));
    if (p.empty() || c.empty()) return false;
    // sous-chaine seulement pour une vraie phrase (>= 6 lettres) : sinon "la",
    // "le", "c'est"... matcheraient par accident a l'interieur de la reponse.
    if (p.size() >= 6 && (c.find(p) != std::string::npos || p.find(c) != std::string::npos)) return true;
    std::vector<std::string> motsP, motsC;
    std::string m = "";
    for (unsigned int i = 0; i <= p.size(); i++) {
        char ch = (i < p.size()) ? p[i] : ' ';
        if (ch == ' ' || ch == '.' || ch == '!' || ch == ',' || ch == ';' || ch == ':' || ch == '\'') {
            if (!m.empty()) { motsP.push_back(m); m = ""; }
        }
        else m += ch;
    }
    m = "";
    for (unsigned int i = 0; i <= c.size(); i++) {
        char ch = (i < c.size()) ? c[i] : ' ';
        if (ch == ' ' || ch == '.' || ch == '!' || ch == ',' || ch == ';' || ch == ':' || ch == '\'') {
            if (!m.empty()) { motsC.push_back(m); m = ""; }
        }
        else m += ch;
    }
    for (unsigned int k = 0; k < motsC.size(); k++) {
        if (motsC[k].size() < 4) continue;
        for (unsigned int w = 0; w < motsP.size(); w++) {
            if (motsP[w].size() < 3) continue;
            if (motsP[w] == motsC[k]) return true;
            int minLen = std::min(motsP[w].size(), motsC[k].size());
            int seuil = (minLen >= 7) ? 2 : 1;
            if (distanceEdit(motsP[w], motsC[k]) <= seuil) return true;
        }
    }
    return false;
}

// Une phrase contient-elle un mot-cle, meme ecrit avec une faute d'orthographe ?
// 1) recherche exacte (rapide, geree par find) ; 2) sinon chaque mot "important"
// de la cle (au moins 4 lettres) doit correspondre a un mot de la phrase.
bool phraseContientCle(const std::string& phrase, const std::string& cleBrute) {
    std::string p = sansAccents(phrase), cle = sansAccents(cleBrute);
    // recherche exacte : le mot-cle doit etre un mot entier, pas un fragment
    // cache dans un autre mot ("accord" n'est pas dans "d'accord", "carte"
    // n'est pas dans "cartes"). Un debut de phrase est accepte d'office.
    std::string::size_type pos = 0;
    while ((pos = p.find(cle, pos)) != std::string::npos) {
        bool avantMot = pos > 0 && ((p[pos - 1] >= 'a' && p[pos - 1] <= 'z') || p[pos - 1] == '\'');
        std::size_t fin = pos + cle.size();
        bool apresMot = fin < p.size() && ((p[fin] >= 'a' && p[fin] <= 'z') || p[fin] == '\'');
        if (!avantMot && !apresMot) return true;
        pos += cle.size();
    }
    if (cle.size() < 4) return false;
    std::vector<std::string> motsP, motsCle;
    std::string m = "";
    for (unsigned int i = 0; i <= p.size(); i++) {
        char ch = (i < p.size()) ? p[i] : ' ';
        if (ch == ' ' || ch == '.' || ch == '!' || ch == ',' || ch == ';' || ch == ':') {
            if (!m.empty()) motsP.push_back(m);
            m = "";
        }
        else m += ch;
    }
    m = "";
    for (unsigned int i = 0; i <= cle.size(); i++) {
        char ch = (i < cle.size()) ? cle[i] : ' ';
        if (ch == ' ') {
            if (!m.empty()) motsCle.push_back(m);
            m = "";
        }
        else m += ch;
    }
    if (motsCle.empty()) return false;
    int total = 0, trouves = 0;
    for (unsigned int k = 0; k < motsCle.size(); k++) {
        if (motsCle[k].size() < 4) continue;
        total++;
        bool ok = false;
        for (unsigned int w = 0; w < motsP.size() && !ok; w++) {
            if (motsProches(motsP[w], motsCle[k])) ok = true;
        }
        if (ok) trouves++;
    }
    if (total == 0) return false;
    return trouves >= total;
}

// Le mot-cle est-il present dans la phrase en toutes lettres (sans tolerance
// aux fautes) ? Utilise pour departager deux cles de meme longueur : la cle
// reellement prononcee doit gagner sur une cle proche orthographiquement.
bool phraseContientCleExact(const std::string& phrase, const std::string& cleBrute) {
    std::string p = sansAccents(phrase), cle = sansAccents(cleBrute);
    std::string::size_type pos = 0;
    while ((pos = p.find(cle, pos)) != std::string::npos) {
        std::size_t fin = pos + cle.size();
        bool apresMot = fin < p.size() && ((p[fin] >= 'a' && p[fin] <= 'z') || p[fin] == '\'');
        if (!apresMot) {
            if (pos == 0) return true;
            char avant = p[pos - 1];
            bool avantMot = (avant >= 'a' && avant <= 'z') || avant == '\'';
            if (!avantMot) return true;
        }
        pos += cle.size();
    }
    return false;
}

// Trouve la categorie (0..13) d'une phrase a partir des mots-cles connus, sinon -1.
int categorieDe(std::string p, std::string motsCategories[14][30]) {
    for (int c = 0; c < 14; c++) {
        for (int m = 0; m < 30; m++) {
            if (motsCategories[c][m].empty()) break;
            if (phraseContientCle(p, motsCategories[c][m])) return c;
        }
    }
    return -1;
}

// Mots trop courts, trop courants ou mal formes pour nourrir les phrases composees.
bool estPetitMot(const std::string& m) {
    if (m.size() < 4) return true;
    if (m.find('\'') != std::string::npos) return true;
    static const char* stop[] = {
        "avec", "pour", "dans", "sur", "bien", "plus", "tres", "tout", "tous",
        "chez", "sans", "alors", "comme", "quand", "cette", "cela", "quel",
        "mais", "donc", "est", "sont", "fait", "faire", "veux", "peux", "meme",
        "sais", "fais", "suis", "vais", "vas", "dit", "dont", "moins", "peut",
        0
    };
    for (int i = 0; stop[i] != 0; i++) if (m == stop[i]) return true;
    return false;
}

// ============ CATEGORISATION DU VOCABULAIRE ============
// Catégories : 0=nom, 1=verbe, 2=adjectif, 3=lieu, 4=temps, 5=personne
enum CategorieMot { CAT_NOM = 0, CAT_VERBE = 1, CAT_ADJECTIF = 2, CAT_LIEU = 3, CAT_TEMPS = 4, CAT_PERSONNE = 5 };

// Détecte la catégorie d'un mot du vocabulaire
CategorieMot categoriserMot(const std::string& mot) {
    std::string m = minuscules(mot);
    size_t n = m.size();
    if (n < 3) return CAT_NOM;

    // --- Verbes (terminaisons -er, -ir, -re, -oir) ---
    if (n >= 3) {
        std::string fin3 = m.substr(n - 3);
        std::string fin2 = m.substr(n - 2);
        if (fin3 == "eur" && n >= 5) {
            // -eur peut etre nom ou verbe, verifier si c'est un verbe connu
            static const char* verbesEur[] = {
                "alloUer", "appeler", "avertir", "bouger", "changer", "chercher",
                "commencer", "compter", "conduire", "considerer", "continuer",
                "controler", "couvrir", "craindre", "creer", "cultiver", "danser",
                "decider", "decrire", "defendre", "developper", "diriger",
                "discuter", "distinguer", "distribuer", "diviser", "ecouter",
                "eduquer", "effectuer", "eliminer", "employer", "encourager",
                "envoyer", "essayer", "etablir", "eviter", "examiner", "excuser",
                "exiger", "expliquer", "explorer", "exposer", "exprimer",
                "fabriquer", "fonder", "fournir", "garder", "gouverner", "grandir",
                "guerir", "habiter", "harasser", "hesiter", "ignorer", "illuminer",
                "imiter", "impliquer", "imposer", "impressionner", "inciter",
                "inclure", "indiquer", "influencer", "informer", "innover",
                "inspirer", "installer", "instruire", "interdire", "interroger",
                "intervenir", "intimider", "introduire", "inventer", "investir",
                "inviter", "isoler", "jouer", "jurer", "justifier", "laver",
                "livrer", "louer", "lutter", "maitriser", "manipuler", "maturer",
                "melanger", "mener", "mesurer", "mettre", "meubler", "migrer",
                "modifier", "monter", "mourir", "mouvoir", "nager", "negocier",
                "nettoyer", "nourrir", "obeir", "obtenir", "occuper", "offrir",
                "oublier", "ouvrir", "parvenir", "payer", "pecher", "peindre",
                "percer", "permettre", "persuader", "peser", "piller", "placer",
                "planter", "plier", "porter", "poser", "posseder", "preparer",
                "presenter", "preserver", "presser", "pretendre", "prevenir",
                "prier", "produire", "progresser", "promener", "promettre",
                "proposer", "proteger", "prouver", "publier", "qualifier",
                "quitter", "raconter", "raser", "realiser", "recueillir",
                "reculer", "reduire", "repondre", "reussir", "servir", "songer",
                "souffrir", "souhaiter", "taper", "toucher", "travailler",
                "trouver", "utiliser", "vendre", "viser", "vivre", "voter",
                "aimer", "adorer", "apprendre", "arriver", "attendre", "avancer",
                "batir", "battre", "cacher", "casser", "celebrer", "corder",
                "corriger", "couper", "deblouir", "deguster", "demarrer",
                "denoncer", "designer", "detester", "disparaitre", "douter",
                "echouer", "embrasser", "emmener", "emouvoir", "empecher",
                "enlever", "enseigner", "envahir", "aprouver", "etonner",
                "excuser", "facher", "fuir", "gager", "garer", "gemir", "glisser",
                "gratter", "informer", "lier", "naitre", "partir", "pleurer",
                "rire", "sourire", "voler", "dire", "faire", "aller", "venir",
                "pouvoir", "vouloir", "devoir", "savoir", "falloir", "pleuvoir",
                "manquer", "paraitre", "entendre", "enterrer", "epouser",
                "inquieter", "jeter", "lever", "loger", "marcher", "meler",
                "ordurer", "peser", "proteger", "rappeler", "regarder",
                "relever", "remplacer", "reparer", "ripper", "risquer",
                "rouler", "signer", "sonner", "taper", "tirer", "tourner",
                0
            };
            for (int i = 0; verbesEur[i] != 0; i++)
                if (m == verbesEur[i]) return CAT_VERBE;
        }
        if (fin2 == "er" && n >= 4) return CAT_VERBE;
        if (fin2 == "ir" && n >= 4) return CAT_VERBE;
        if (fin2 == "re" && n >= 4) return CAT_VERBE;
        if (fin2 == "oir" && n >= 5) return CAT_VERBE;
        if (fin3 == "oir" && n >= 5) return CAT_VERBE;
    }

    // --- Adjectifs (terminaisons) ---
    if (n >= 4) {
        std::string fin4 = m.substr(n - 4);
        std::string fin3 = m.substr(n - 3);
        std::string fin2 = m.substr(n - 2);
        if (fin3 == "eux" || fin3 == "eif" || fin3 == "tif" ||
            fin3 == "ble" || fin4 == "ique" || fin3 == "ent" || fin3 == "ant" ||
            fin2 == "al" || fin3 == "el" || fin3 == "il" || fin3 == "in" ||
            fin3 == "is" || fin3 == "ois" || fin3 == "ique" || fin3 == "ine" ||
            fin3 == "aux") return CAT_ADJECTIF;
    }

    // --- Lieux (mots connus du vocabulaire) ---
    static const char* lieux[] = {
        "maison", "ecole", "bureau", "parc", "plage", "montagne", "ville",
        "village", "rue", "restaurant", "hotel", "magasin", "hopital",
        "musee", "cinema", "theatre", "gare", "aeroport", "port", "jardin",
        "cuisine", "chambre", "salon", "cave", "grenier", "garage", "terrasse",
        "fenetre", "cimetiere", "usine", "atelier", "studio", "cabin",
        "cabane", "igloo", "tipi", "yurt", "yourte", "chalet", "villa",
        "immeuble", "bloc", "etage", "salle", "couloir", "entree", "sortie",
        "arriere", "devant", "centre", "coin", "bout", "milieu", "bord",
        "terre", "mer", "ocean", "lac", "fleuve", "riviere", "source",
        "champ", "foret", "bois", "ile", "desert", "volcan", "colline",
        "vallee", "gorge", "canyon", "plateau", "crevasse", "grotte",
        "caverne", "tunnel", "pont", "route", "chemin", "sentier", "autoroute",
        0
    };
    for (int i = 0; lieux[i] != 0; i++)
        if (m == lieux[i]) return CAT_LIEU;

    // --- Temps ---
    static const char* temps[] = {
        "jour", "nuit", "semaine", "mois", "annee", "matin", "soir",
        "midi", "minuit", "hier", "demain", "aujourd", "lundi", "mardi",
        "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
        "janvier", "fevrier", "mars", "avril", "mai", "juin",
        "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
        "printemps", "ete", "automne", "hiver", "heure", "minute", "seconde",
        "moment", "instant", "debut", "fin", "duree", "periode", "epoque",
        "siecle", "millenaire", "decennie", "bientot", "totard",
        0
    };
    for (int i = 0; temps[i] != 0; i++)
        if (m == temps[i]) return CAT_TEMPS;

    // --- Personnes ---
    static const char* personnes[] = {
        "homme", "femme", "enfant", "bebe", "garcon", "fille", "ami",
        "amie", "voisin", "voisine", "collegue", "patron", "employe",
        "ouvrier", "medecin", "infirmier", "professeur", "eleve",
        "etudiant", "cuisinier", "boulanger", "mecanicien", "policier",
        "pompier", "soldat", "joueur", "chanteur", "danseur", "acteur",
        "realisateur", "ecrivain", "peintre", "sculpteur", "architecte",
        "inventeur", "decouvreur", "explorateur", "voyageur", "pelerin",
        "berger", "paysan", "fermier", "jardinier", "juge", "avocat",
        "notaire", "comptable", "informaticien", "ingenieur", "technicien",
        "scientifique", "chercheur", "professeur", "directeur", "manager",
        "chef", "responsable", "delegue", "president", "ministre", "roi",
        "reine", "prince", "princesse", "chevalier", "soldat", "guerrier",
        0
    };
    for (int i = 0; personnes[i] != 0; i++)
        if (m == personnes[i]) return CAT_PERSONNE;

    // Par défaut : nom
    return CAT_NOM;
}

// ============ BLOC PHRASE : construire une phrase neuve et coherente ============
// Une reponse est assemblee a partir de petits blocs :
//   - SUJET     : qui parle (je, on, nous, tu)
//   - VERBE     : conjugue pour s'accorder avec le sujet
//   - COMPLEMENT: le theme de la phrase de l'utilisateur (reutilise tel quel,
//                 pour que la reponse reste en cohesion avec ce qu'il a dit),
//                 ou un mot qu'on connait deja quand la phrase n'a pas de theme
//   - FAITS     : ce qu'on sait de lui (age, plat, hobby, gouts, nom...)
// Ce bloc sert en dernier recours, quand aucune question/reponse connue ne
// correspond a la phrase, meme d'un peu. Il s'ajoute a composerPhrase sans
// jamais remplacer les autres facons de repondre.

// ============ BLOCS SUJET / VERBE / COMPLEMENT ============
// Le bloc PHRASE assemble un SUJET, un VERBE conjugue et un COMPLEMENT.
// Le sujet donne sa personne (je, tu, il...), le verbe s'accorde avec lui,
// et le complement est choisi pour rester coherent avec le verbe.

// Un sujet du bloc SUJET : sa personne grammaticale (0=je, 1=tu, 2=il/elle/on,
// 3=nous, 4=vous, 5=ils/elles) et son genre/nombre pour accorder le participe
// passe des temps composes ("elle est allee", "ils sont partis").
struct Sujet {
    const char* texte;
    int personne;
    int feminin;   // 1 si feminin
    int pluriel;   // 1 si pluriel
};

static const Sujet sujets[] = {
    { "je", 0, 0, 0 }, { "tu", 1, 0, 0 }, { "il", 2, 0, 0 },
    { "elle", 2, 1, 0 }, { "on", 2, 0, 0 }, { "nous", 3, 0, 1 },
    { "vous", 4, 0, 1 }, { "ils", 5, 0, 1 }, { "elles", 5, 1, 1 },
    { "ma mere", 2, 1, 0 }, { "mon pere", 2, 0, 0 }, { "mon frere", 2, 0, 0 },
    { "ma soeur", 2, 1, 0 }, { "mon mari", 2, 0, 0 }, { "ma femme", 2, 1, 0 },
    { "mon enfant", 2, 0, 0 }, { "mon bebe", 2, 0, 0 }, { "ma grand-mere", 2, 1, 0 },
    { "mon oncle", 2, 0, 0 }, { "mon cousin", 2, 0, 0 }, { "mes enfants", 5, 0, 1 },
    { "le patron", 2, 0, 0 }, { "mon collegue", 2, 0, 0 }, { "le professeur", 2, 0, 0 },
    { "le medecin", 2, 0, 0 }, { "le facteur", 2, 0, 0 }, { "le boulanger", 2, 0, 0 },
    { "la caissiere", 2, 1, 0 }, { "le chauffeur de bus", 2, 0, 0 }, { "le plombier", 2, 0, 0 },
    { "la nounou", 2, 1, 0 },
    { "la television", 2, 1, 0 }, { "mon telephone", 2, 0, 0 }, { "la voiture", 2, 1, 0 },
    { "la cle", 2, 1, 0 }, { "l'ordinateur", 2, 0, 0 }, { "la machine a laver", 2, 1, 0 },
    { "le frigo", 2, 0, 0 }, { "la lampe", 2, 1, 0 }, { "la montre", 2, 1, 0 },
    { "le porte-monnaie", 2, 0, 0 }, { "le cafe", 2, 0, 0 }, { "le pain", 2, 0, 0 },
    { "l'eau", 2, 1, 0 }, { "le lait", 2, 0, 0 }, { "le gateau", 2, 0, 0 },
    { "le repas", 2, 0, 0 }, { "la soupe", 2, 1, 0 }, { "le chocolat", 2, 0, 0 },
    { "le vin", 2, 0, 0 }, { "le soleil", 2, 0, 0 }, { "la pluie", 2, 1, 0 },
    { "le vent", 2, 0, 0 }, { "la neige", 2, 1, 0 }, { "le froid", 2, 0, 0 },
    { "la chaleur", 2, 1, 0 }, { "le ciel", 2, 0, 0 }, { "l'orage", 2, 0, 0 },
    { "la lune", 2, 1, 0 }, { "la tete", 2, 1, 0 }, { "le coeur", 2, 0, 0 },
    { "la main", 2, 1, 0 }, { "le pied", 2, 0, 0 }, { "le dos", 2, 0, 0 },
    { "la jambe", 2, 1, 0 }, { "le ventre", 2, 0, 0 },
    { "les fruits", 5, 0, 1 }, { "les nuages", 5, 0, 1 }, { "les yeux", 5, 0, 1 },
    { "les oreilles", 5, 1, 1 }, { "les cheveux", 5, 0, 1 },
    { "le matin", 2, 0, 0 }, { "le soir", 2, 0, 0 }, { "la nuit", 2, 1, 0 },
    { "aujourd'hui", 2, 0, 0 }, { "demain", 2, 0, 0 }, { "la semaine", 2, 1, 0 },
    { "le week-end", 2, 0, 0 }, { "le mois", 2, 0, 0 }, { "l'annee", 2, 1, 0 },
    { "l'hiver", 2, 0, 0 }, { "l'amour", 2, 0, 0 }, { "la joie", 2, 1, 0 },
    { "la colere", 2, 1, 0 }, { "la peur", 2, 1, 0 }, { "le stress", 2, 0, 0 },
    { "la fatigue", 2, 1, 0 }, { "l'ennui", 2, 0, 0 }, { "le bonheur", 2, 0, 0 },
    { "la tristesse", 2, 1, 0 }, { "le courage", 2, 0, 0 },
    { "la maison", 2, 1, 0 }, { "le bureau", 2, 0, 0 }, { "l'ecole", 2, 1, 0 },
    { "le magasin", 2, 0, 0 }, { "la rue", 2, 1, 0 }, { "le parc", 2, 0, 0 },
    { "la gare", 2, 1, 0 }, { "la plage", 2, 1, 0 }, { "la montagne", 2, 1, 0 }
};
#define NB_SUJETS (sizeof(sujets) / sizeof(sujets[0]))

// Personne grammaticale du sujet donne (0 a 5), + genre/nombre pour l'accord.
int personneSujet(const std::string& s, int& feminin, int& pluriel) {
    std::string n = minuscules(sansAccents(s));
    for (unsigned int i = 0; i < NB_SUJETS; i++) {
        if (n == sujets[i].texte) {
            feminin = sujets[i].feminin;
            pluriel = sujets[i].pluriel;
            return sujets[i].personne;
        }
    }
    feminin = 0; pluriel = 0;
    return 2;   // sujet inconnu : 3e personne du singulier
}

// Un verbe du bloc VERBE : ses formes pour les 6 personnes au present, les
// racines de l'imparfait et du futur (pour construire aussi le conditionnel et
// les temps composes), le participe passe, l'auxiliaire et la categorie de
// complement qui lui va (0=COD, 1=COI, 2=lieu, 3=temps, 4=maniere, 5=infinitif).
struct Verbe {
    std::string infinitif;
    std::string present[6];
    std::string imparfait;   // racine (on ajoute ais/ais/ait/ions/iez/aient)
    std::string futur;       // racine (on ajoute ai/as/a/ons/ez/ont)
    std::string participe;   // participe passe
    bool pronominal;         // se lever, s'habiller...
    bool auxEtre;            // temps composes avec "etre"
    int complementType;      // 0=COD 1=COI 2=lieu 3=temps 4=maniere 5=infinitif
};

static std::vector<Verbe> verbes;
static std::map<std::string, int> verbeIndex;

static void pousserVerbe(const Verbe& v) {
    verbeIndex[v.infinitif] = (int)verbes.size();
    verbes.push_back(v);
}

// Verbe regulier en -er (la majorite). variante : 0=normal, 1="manger" (ger),
// 2="commencer" (cer), 3="appeler" (double l), 4="payer" (yer).
static void ajouterER(const std::string& inf, int type, int variante,
                      bool pronominal, bool auxEtre) {
    Verbe v;
    v.infinitif = inf;
    v.pronominal = pronominal;
    v.auxEtre = auxEtre;
    v.complementType = type;
    std::string base = inf;
    if (base.compare(0, 3, "se ") == 0) base = base.substr(3);
    else if (base.compare(0, 2, "s'") == 0) base = base.substr(2);
    std::string r = base.substr(0, base.size() - 2);
    v.present[0] = r + "e"; v.present[1] = r + "es"; v.present[2] = r + "e";
    v.present[3] = r + "ons"; v.present[4] = r + "ez"; v.present[5] = r + "ent";
    v.imparfait = r;
    v.futur = base;
    v.participe = r + "e";
    if (variante == 1) { v.present[3] = r + "eons"; v.imparfait = r + "e"; }
    else if (variante == 2) { v.present[3] = r + "cons"; }
    else if (variante == 3) {
        v.present[0] = r + "le"; v.present[1] = r + "les"; v.present[2] = r + "le";
        v.present[3] = r + "ons"; v.present[4] = r + "ez"; v.present[5] = r + "lent";
        v.futur = r + "ler";
    }
    else if (variante == 4) {
        std::string ry = r.substr(0, r.size() - 1);
        v.present[0] = ry + "ie"; v.present[1] = ry + "ies"; v.present[2] = ry + "ie";
        v.present[3] = r + "ons"; v.present[4] = r + "ez"; v.present[5] = ry + "ient";
        v.futur = ry + "ier";
    }
    pousserVerbe(v);
}

// Verbe regulier en -ir (2e groupe : choisir, finir...).
static void ajouterIR(const std::string& inf, int type) {
    Verbe v;
    v.infinitif = inf;
    v.pronominal = false; v.auxEtre = false; v.complementType = type;
    std::string r = inf.substr(0, inf.size() - 2);
    v.present[0] = r + "is"; v.present[1] = r + "is"; v.present[2] = r + "it";
    v.present[3] = r + "issons"; v.present[4] = r + "issez"; v.present[5] = r + "issent";
    v.imparfait = r + "iss";
    v.futur = inf;
    v.participe = r + "i";
    pousserVerbe(v);
}

// Verbe regulier en -re (attendre, vendre, perdre...).
static void ajouterRE(const std::string& inf, int type, bool auxEtre) {
    Verbe v;
    v.infinitif = inf;
    v.pronominal = false; v.auxEtre = auxEtre; v.complementType = type;
    std::string r = inf.substr(0, inf.size() - 2);
    v.present[0] = r + "s"; v.present[1] = r + "s"; v.present[2] = r;
    v.present[3] = r + "ons"; v.present[4] = r + "ez"; v.present[5] = r + "ent";
    v.imparfait = r;
    v.futur = inf;
    v.participe = r + "u";
    pousserVerbe(v);
}

// Verbe irregulier : on fournit toutes les formes du present + les racines.
static void ajouterIrr(const std::string& inf, int type, bool pronominal, bool auxEtre,
                       const std::string& pp, const std::string& imp, const std::string& fut,
                       const std::string& p1, const std::string& p2, const std::string& p3,
                       const std::string& p4, const std::string& p5, const std::string& p6) {
    Verbe v;
    v.infinitif = inf;
    v.pronominal = pronominal; v.auxEtre = auxEtre; v.complementType = type;
    v.present[0] = p1; v.present[1] = p2; v.present[2] = p3;
    v.present[3] = p4; v.present[4] = p5; v.present[5] = p6;
    v.imparfait = imp; v.futur = fut; v.participe = pp;
    pousserVerbe(v);
}

// Construit la table des verbes du bloc VERBE. Type de complement :
// 0=COD 1=COI 2=lieu 3=temps 4=maniere 5=infinitif.
static void initialiserVerbes() {
    if (!verbes.empty()) return;

    // Verbes qui se construisent avec un infinitif ("j'aime en savoir plus...")
    ajouterER("aimer", 5, 0, false, false);
    ajouterER("adorer", 5, 0, false, false);
    ajouterER("detester", 5, 0, false, false);
    ajouterER("souhaiter", 5, 0, false, false);
    ajouterER("esperer", 5, 0, false, false);
    ajouterIrr("savoir", 5, false, false, "su", "sav", "saur",
               "sais", "sais", "sait", "savons", "savez", "savent");
    ajouterIrr("pouvoir", 5, false, false, "pu", "pouv", "pourr",
               "peux", "peux", "peut", "pouvons", "pouvez", "peuvent");
    ajouterIrr("vouloir", 5, false, false, "voulu", "voul", "voudr",
               "veux", "veux", "veut", "voulons", "voulez", "veulent");
    ajouterIrr("devoir", 5, false, false, "du", "dev", "devr",
               "dois", "dois", "doit", "devons", "devez", "doivent");

    // Verbes transitifs (COD : "je mange une pomme")
    ajouterER("regarder", 0, 0, false, false);
    ajouterER("ecouter", 0, 0, false, false);
    ajouterER("manger", 0, 1, false, false);
    ajouterER("fermer", 0, 0, false, false);
    ajouterER("montrer", 0, 0, false, false);
    ajouterER("acheter", 0, 0, false, false);
    ajouterER("payer", 0, 4, false, false);
    ajouterER("trouver", 0, 0, false, false);
    ajouterER("gagner", 0, 0, false, false);
    ajouterER("garder", 0, 0, false, false);
    ajouterER("appeler", 0, 3, false, false);
    ajouterER("cuisiner", 0, 0, false, false);
    ajouterER("nettoyer", 0, 4, false, false);
    ajouterER("ranger", 0, 1, false, false);
    ajouterER("reparer", 0, 0, false, false);
    ajouterER("expliquer", 0, 0, false, false);
    ajouterER("aider", 0, 0, false, false);
    ajouterER("remercier", 0, 0, false, false);
    ajouterER("oublier", 0, 0, false, false);
    ajouterER("imaginer", 0, 0, false, false);
    ajouterER("decider", 0, 0, false, false);
    ajouterER("essayer", 0, 4, false, false);
    ajouterER("commencer", 0, 2, false, false);
    ajouterER("arreter", 0, 0, false, false);
    ajouterER("echouer", 0, 0, false, false);
    ajouterIR("choisir", 0);
    ajouterIR("reussir", 0);
    ajouterIR("finir", 0);
    ajouterRE("perdre", 0, false);
    ajouterRE("rendre", 0, false);
    ajouterRE("vendre", 0, false);
    ajouterIrr("avoir", 0, false, false, "eu", "av", "aur",
               "ai", "as", "a", "avons", "avez", "ont");
    ajouterIrr("faire", 0, false, false, "fait", "fais", "fer",
               "fais", "fais", "fait", "faisons", "faites", "font");
    ajouterIrr("dire", 0, false, false, "dit", "dis", "dir",
               "dis", "dis", "dit", "disons", "dites", "disent");
    ajouterIrr("voir", 0, false, false, "vu", "voy", "verr",
               "vois", "vois", "voit", "voyons", "voyez", "voient");
    ajouterIrr("prendre", 0, false, false, "pris", "pren", "prendr",
               "prends", "prends", "prend", "prenons", "prenez", "prennent");
    ajouterIrr("mettre", 0, false, false, "mis", "mett", "mettr",
               "mets", "mets", "met", "mettons", "mettez", "mettent");
    ajouterIrr("boire", 0, false, false, "bu", "buv", "boir",
               "bois", "bois", "boit", "buvons", "buvez", "boivent");
    ajouterIrr("lire", 0, false, false, "lu", "lis", "lir",
               "lis", "lis", "lit", "lisons", "lisez", "lisent");
    ajouterIrr("ecrire", 0, false, false, "ecrit", "ecriv", "ecrir",
               "ecris", "ecris", "ecrit", "ecrivons", "ecrivez", "ecrivent");
    ajouterIrr("croire", 0, false, false, "cru", "croy", "croir",
               "crois", "crois", "croit", "croyons", "croyez", "croient");
    ajouterIrr("ouvrir", 0, false, false, "ouvert", "ouvr", "ouvrir",
               "ouvre", "ouvres", "ouvre", "ouvrons", "ouvrez", "ouvrent");
    ajouterIrr("envoyer", 0, false, false, "envoye", "envoy", "enverr",
               "envoie", "envoies", "envoie", "envoyons", "envoyez", "envoient");
    ajouterIrr("recevoir", 0, false, false, "recu", "recev", "recevr",
               "recois", "recois", "recoit", "recevons", "recevez", "recoivent");

    // Verbes a COI ("je parle a ma mere")
    ajouterER("parler", 1, 0, false, false);
    ajouterER("donner", 1, 0, false, false);
    ajouterER("penser", 1, 0, false, false);
    ajouterER("rever", 1, 0, false, false);
    ajouterER("demander", 1, 0, false, false);
    ajouterER("pardonner", 1, 0, false, false);
    ajouterER("s'excuser", 1, 0, true, true);
    ajouterRE("repondre", 1, false);

    // Verbes de lieu ("je vais a la maison")
    ajouterER("arriver", 2, 0, false, true);
    ajouterER("rentrer", 2, 0, false, true);
    ajouterER("monter", 2, 0, false, true);
    ajouterER("rester", 2, 0, false, true);
    ajouterER("tomber", 2, 0, false, true);
    ajouterER("passer", 2, 0, false, false);
    ajouterER("voyager", 2, 1, false, false);
    ajouterIrr("dormir", 2, false, false, "dormi", "dorm", "dormir",
               "dors", "dors", "dort", "dormons", "dormez", "dorment");
    ajouterER("se lever", 2, 0, true, true);
    ajouterER("se coucher", 2, 0, true, true);
    ajouterER("s'habiller", 2, 0, true, true);
    ajouterER("se laver", 2, 0, true, true);
    ajouterER("se reposer", 2, 0, true, true);
    ajouterRE("descendre", 2, true);
    ajouterIrr("aller", 2, false, true, "allé", "all", "ir",
               "vais", "vas", "va", "allons", "allez", "vont");
    ajouterIrr("venir", 2, false, true, "venu", "ven", "viendr",
               "viens", "viens", "vient", "venons", "venez", "viennent");
    ajouterIrr("partir", 2, false, true, "parti", "part", "partir",
               "pars", "pars", "part", "partons", "partez", "partent");
    ajouterIrr("sortir", 2, false, true, "sorti", "sort", "sortir",
               "sors", "sors", "sort", "sortons", "sortez", "sortent");
    ajouterIrr("s'asseoir", 2, true, true, "assis", "assey", "assier",
               "assieds", "assieds", "assied", "asseyons", "asseyez", "asseyent");

    // Verbes de temps ("je travaille toute la journee")
    ajouterER("travailler", 3, 0, false, false);
    ajouterER("continuer", 3, 0, false, false);
    ajouterRE("attendre", 3, false);

    // Verbes de maniere ("je chante vite")
    ajouterER("marcher", 4, 0, false, false);
    ajouterER("chanter", 4, 0, false, false);
    ajouterER("danser", 4, 0, false, false);
    ajouterER("jouer", 4, 0, false, false);
    ajouterER("pleurer", 4, 0, false, false);
    ajouterER("crier", 4, 0, false, false);
    ajouterER("chuchoter", 4, 0, false, false);
    ajouterER("sonner", 4, 0, false, false);
    ajouterER("couter", 4, 0, false, false);
    ajouterER("avancer", 4, 2, false, false);
    ajouterER("reculer", 4, 0, false, false);
    ajouterER("tourner", 4, 0, false, false);
    ajouterIrr("courir", 4, false, false, "couru", "cour", "courr",
               "cours", "cours", "court", "courons", "courez", "courent");
    ajouterIrr("rire", 4, false, false, "ri", "ri", "rir",
               "ris", "ris", "rit", "rions", "riez", "rient");
    ajouterIrr("sourire", 4, false, false, "souri", "souri", "sourir",
               "souris", "souris", "sourit", "sourions", "souriez", "sourient");
    ajouterIrr("se souvenir", 4, true, true, "souvenu", "souven", "souviendr",
               "souviens", "souviens", "souvient", "souvenons", "souvenez", "souviennent");
    ajouterIrr("etre", 4, false, false, "ete", "et", "ser",
               "suis", "es", "est", "sommes", "etes", "sont");
}

// Terminaisons partagees par plusieurs temps.
static const char* termImparfait[6] = { "ais", "ais", "ait", "ions", "iez", "aient" };
static const char* termFutur[6] = { "ai", "as", "a", "ons", "ez", "ont" };
static const char* reflechis[6] = { "me", "te", "se", "nous", "vous", "se" };

static bool commenceParVoyelle(const std::string& s) {
    if (s.empty()) return false;
    char c = s[0];
    return c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u' || c == 'h';
}

// Forme conjuguee de l'auxiliaire (etre/avoir) pour un temps compose.
static std::string formeAuxiliaire(const std::string& aux, int personne, int temps) {
    if (aux == "etre") {
        if (temps == 0) {
            static const char* p[6] = { "suis", "es", "est", "sommes", "etes", "sont" };
            return p[personne];
        }
        return std::string("et") + termImparfait[personne];
    }
    if (temps == 0) {
        static const char* p[6] = { "ai", "as", "a", "avons", "avez", "ont" };
        return p[personne];
    }
    return std::string("av") + termImparfait[personne];
}

// Participe passe accorde avec le sujet ("allee", "partis").
static std::string participeAccorde(const std::string& pp, int feminin, int pluriel) {
    std::string r = pp;
    if (feminin) r += "e";
    if (pluriel) r += "s";
    return r;
}

// Pronom reflechi devant un verbe ("me " ou "m'" selon la voyelle).
static std::string reflechiAvecEspace(const std::string& refl, bool voyelle) {
    if (voyelle && (refl == "me" || refl == "te" || refl == "se"))
        return refl.substr(0, 1) + "'";
    return refl + " ";
}

// Conjugue l'infinitif pour le sujet donne et le temps voulu.
// temps : 0=present, 1=imparfait, 2=futur, 3=conditionnel,
//         4=passe compose, 5=plus-que-parfait.
std::string conjuguer(const std::string& sujet, const std::string& infinitif, int temps) {
    initialiserVerbes();
    std::string inf = minuscules(sansAccents(infinitif));
    std::map<std::string, int>::const_iterator it = verbeIndex.find(inf);
    if (it == verbeIndex.end()) {
        // verbe pronominal ("se lever", "s'habiller") : on cherche aussi sans
        // le pronom, au cas ou l'appelant a fourni la forme nue.
        std::string nu = inf;
        if (nu.compare(0, 3, "se ") == 0) nu = nu.substr(3);
        else if (nu.compare(0, 2, "s'") == 0) nu = nu.substr(2);
        it = verbeIndex.find(nu);
    }
    if (it == verbeIndex.end()) return sujet + " " + inf;
    const Verbe& v = verbes[it->second];

    int feminin, pluriel;
    int pers = personneSujet(sujet, feminin, pluriel);
    std::string sujetN = minuscules(sansAccents(sujet));

    if (temps == 4 || temps == 5) {
        // temps compose : auxiliaire + participe passe
        std::string aux = (v.auxEtre || v.pronominal) ? "etre" : "avoir";
        int auxTemps = (temps == 4) ? 0 : 1;
        std::string formeAux = formeAuxiliaire(aux, pers, auxTemps);
        // l'accord du participe se fait avec le sujet seulement quand l'auxiliaire
        // est "etre" ("elle est allee") ; avec "avoir", il reste invariable.
        std::string pp = (aux == "etre") ? participeAccorde(v.participe, feminin, pluriel)
                                         : v.participe;
        if (v.pronominal) {
            std::string refl = reflechiAvecEspace(reflechis[pers], commenceParVoyelle(formeAux));
            return sujet + " " + refl + formeAux + " " + pp;
        }
        if (sujetN == "je" && commenceParVoyelle(formeAux)) return "j'" + formeAux + " " + pp;
        return sujet + " " + formeAux + " " + pp;
    }

    // temps simple
    std::string forme;
    if (temps == 0) forme = v.present[pers];
    else if (temps == 1) forme = v.imparfait + termImparfait[pers];
    else if (temps == 2) forme = v.futur + termFutur[pers];
    else forme = v.futur + termImparfait[pers];   // conditionnel

    if (v.pronominal) {
        std::string refl = reflechiAvecEspace(reflechis[pers], commenceParVoyelle(forme));
        return sujet + " " + refl + forme;
    }
    if (sujetN == "je" && commenceParVoyelle(forme)) return "j'" + forme;
    return sujet + " " + forme;
}

// Comprend la phrase de l'utilisateur : on retire le plus grand mot porteur de
// sens (le theme), qui sera reutilise dans la phrase construite. Les petits mots
// et les formes verbales courantes sont ignores. Un verbe conjugue en "ent"
// ("dorment", "crient") n'est choisi que s'il n'y a pas de vrai mot candidat.
std::string extraireTheme(const std::string& p) {
    static const char* inutiles[] = {
        "aime", "pense", "veux", "peux", "vais", "suis", "fait", "faire",
        "sais", "fais", "dis", "crois", "trouve", "connais", "parle", "regarde",
        "ecoute", "mange", "bois", "veut", "peut", "aller", "voir", "dire",
        "avoir", "etre", "encore", "aussi", "assez", "tout", "toute", "tous",
        "toutes", "rien", "chose", "quelque", "moi", "toi", "oui", "non",
        "pourquoi", "comment", "quand", "quel", "quelle", "quels", "quelles",
        "combien", "lequel", "laquelle", "lesquels", "lesquelles", "quoi",
        // formes verbales du present les plus frequentes : ce sont des verbes
        // conjugues, pas des themes ("en apprendre plus sur ecoutes" est faux)
        "beaucoup", "toujours", "jamais", "souvent", "apres", "avant",
        "aimes", "adores", "detestes", "souhaites", "esperes", "penses",
        "ecoutes", "regardes", "trouves", "parles", "manges", "bois", "dors",
        "veux", "veut", "peut", "dois", "doit", "sais", "sait", "crois",
        "croit", "vois", "voit", "attends", "attend", "mets", "met", "prends",
        "prend", "lis", "lit", "ecris", "ecrit", "ouvres", "ouvre", "envoies",
        "envoie", "recois", "recoit", "achetes", "achete", "payes", "paye",
        "gagnes", "gagne", "gardes", "garde", "appelles", "appelle",
        "cuisines", "cuisine", "nettoies", "nettoie", "ranges", "range",
        "repares", "repare", "expliques", "explique", "aides", "aide",
        "remercies", "remercie", "oublies", "oublie", "imagines", "imagine",
        "decides", "decide", "essaies", "essaie", "commences", "commence",
        "arretes", "arrete", "echoues", "echoue", "choisis", "choisit",
        "reussis", "reussit", "finis", "finit", "perds", "perd", "rends",
        "rend", "vends", "vend", "joues", "joue", "chantes", "chante",
        "danses", "danse", "marches", "marche", "travailles", "travaille",
        "continues", "continue", "arrives", "arrive", "rentres", "rentre",
        "montes", "monte", "restes", "reste", "tombes", "tombe", "passes",
        "passe", "voyages", "voyage", "cours", "court", "reponds", "repond",
        "cherches", "cherche", "va", "vont", "faisons", "faites", "font",
        "allons", "allez", "savons", "savez", "savent", "pouvons", "pouvez",
        "peuvent", "voulons", "voulez", "veulent", "devons", "devez",
        "doivent", "sommes", "etes", "sont", "avons", "avez", "ont",
        0
    };
    std::vector<std::string> candidats;
    std::string t = minuscules(sansAccents(p));
    std::string mot;
    for (unsigned int i = 0; i <= t.size(); i++) {
        char c = (i < t.size()) ? t[i] : ' ';
        if (c == ' ' || c == '?' || c == '!' || c == '.' || c == ',' || c == '\'' ||
            c == '-' || c == ';' || c == ':' || c == '(' || c == ')') {
            if (!mot.empty() && !estPetitMot(mot)) {
                bool inutile = false;
                for (int k = 0; inutiles[k] != 0; k++) {
                    if (mot == inutiles[k]) { inutile = true; break; }
                }
                if (!inutile) candidats.push_back(mot);
            }
            mot = "";
        }
        else mot += c;
    }
    if (candidats.empty()) return "";

    // le plus grand mot ; une terminaison en "ent" (verbe au pluriel) n'est
    // retenue que si aucun vrai mot ne peut prendre sa place.
    std::string meilleur = candidats[0];
    for (unsigned int i = 1; i < candidats.size(); i++)
        if (candidats[i].size() > meilleur.size()) meilleur = candidats[i];
    bool finEnEnt = meilleur.size() >= 4 && meilleur.compare(meilleur.size() - 3, 3, "ent") == 0;
    if (finEnEnt) {
        std::string meilleur2;
        for (unsigned int i = 0; i < candidats.size(); i++) {
            bool finEnt = candidats[i].size() >= 4 &&
                          candidats[i].compare(candidats[i].size() - 3, 3, "ent") == 0;
            if (finEnt) continue;
            if (meilleur2.empty() || candidats[i].size() > meilleur2.size())
                meilleur2 = candidats[i];
        }
        if (!meilleur2.empty()) meilleur = meilleur2;
    }
    return meilleur;
}

// Construit une phrase factuelle a partir d'un fait connu sur l'utilisateur
// ("tu as 25 ans", "ton passe-temps, c'est X"...), ou "" si aucun fait connu.
std::string phraseFactuelle(const std::string& nom, const std::string& age,
                            const std::string& hobby, const std::string& aime,
                            const std::string& aimePas,
                            const std::string& genre) {
    std::vector<std::string> faits;
    if (!age.empty()) {
        faits.push_back("Je me souviens que tu as " + age + " ans.");
        faits.push_back("Tu m'avais dit que tu avais " + age + " ans, non ?");
    }
    if (!aime.empty()) {
        faits.push_back("Toi, tu aimes " + aime + ", je m'en souviens.");
        faits.push_back("Ton truc prefere, c'est " + aime + ".");
    }
    if (!hobby.empty()) {
        faits.push_back("Ton passe-temps, c'est " + hobby + ", non ?");
        faits.push_back("Tu adores " + hobby + ", ca je n'oublie pas.");
    }
    if (!aimePas.empty()) faits.push_back("Tu n'aimes pas " + aimePas + ", c'est note.");
    if (!nom.empty()) {
        std::string salut = (genre == "feminin") ? "Heureuse" : "Heureux";
        faits.push_back(salut + " de te parler, " + nom + ".");
    }
    if (faits.empty()) return "";
    return faits[prochainIndice((int)faits.size())];
}

// Assemble une phrase neuve avec le bloc PHRASE. Le COMPLEMENT est construit
// autour du theme de la phrase de l'utilisateur (cohésion avec ce qu'il dit),
// ou autour d'un mot deja connu. Quand il n'y a aucun theme exploitable, on
// reprend un FAIT connu sur lui (age, plat, hobby, gouts, nom). Le SUJET et le
// VERBE sont ensuite choisis et conjugues pour rester coherents ensemble.
std::string construirePhraseBloc(const std::string& p,
                                 const std::string& nom,
                                 const std::string& age,
                                 const std::string& hobby,
                                 const std::string& aime,
                                 const std::string& aimePas,
                                 const std::string& genre,
                                 const std::vector<std::string>& cles,
                                 const std::vector<std::string>& vocabulaire,
                                 const std::map<std::string, int>& motsFavoris) {
    // bloc COMPLEMENT : le theme de la phrase de l'utilisateur, sinon un mot
    // deja connu (vocabulaire, connaissances, mots qu'il emploie souvent) pour
    // que le bot se developpe avec les mots qu'il apprend.
    std::string theme = extraireTheme(p);
    if (theme.empty()) {
        std::vector<std::string> connus;
        for (unsigned int i = 0; i < vocabulaire.size(); i++)
            if (!estPetitMot(vocabulaire[i])) connus.push_back(vocabulaire[i]);
        for (unsigned int i = 0; i < cles.size(); i++)
            if (cles[i].find(' ') == std::string::npos && !estPetitMot(cles[i]))
                connus.push_back(cles[i]);
        for (std::map<std::string, int>::const_iterator it = motsFavoris.begin(); it != motsFavoris.end(); ++it)
            if (it->second >= 2 && !estPetitMot(it->first)) connus.push_back(it->first);
        if (!connus.empty()) theme = connus[prochainIndice((int)connus.size())];
    }

    // toujours aucun theme exploitable : on repart sur un fait connu (bloc
    // FAITS : age, gouts, hobby, nom) pour parler de ce qu'on sait vraiment.
    if (theme.empty()) {
        std::string fait = phraseFactuelle(nom, age, hobby, aime, aimePas, genre);
        if (!fait.empty()) return fait;
    }

    // blocs SUJET et VERBE : un sujet de toute la liste, un verbe de toute la
    // table (plus de 100 verbes), conjugues pour s'accorder ensemble.
    initialiserVerbes();
    const Verbe& v = verbes[prochainIndice((int)verbes.size())];
    std::string sujet = sujets[prochainIndice((int)NB_SUJETS)].texte;
    std::string verbe = v.infinitif;

    // bloc COMPLEMENT : toujours en lien avec le theme de l'utilisateur
    // quand il est disponible, pour que la reponse soit coherente.
    std::string complement;

    // Séparer le vocabulaire par catégorie pour usage dynamique
    std::vector<std::string> vocabNoms, vocabVerbes, vocabAdj, vocabLieux, vocabTemps, vocabPersonnes;
    for (unsigned int i = 0; i < vocabulaire.size(); i++) {
        if (estPetitMot(vocabulaire[i])) continue;
        CategorieMot cat = categoriserMot(vocabulaire[i]);
        switch (cat) {
            case CAT_NOM:      vocabNoms.push_back(vocabulaire[i]); break;
            case CAT_VERBE:    vocabVerbes.push_back(vocabulaire[i]); break;
            case CAT_ADJECTIF: vocabAdj.push_back(vocabulaire[i]); break;
            case CAT_LIEU:     vocabLieux.push_back(vocabulaire[i]); break;
            case CAT_TEMPS:    vocabTemps.push_back(vocabulaire[i]); break;
            case CAT_PERSONNE: vocabPersonnes.push_back(vocabulaire[i]); break;
        }
    }

    // ===== PRIORITE : TOUJOURS UTILISER LE THEME QUAND IL EXISTE =====
    if (!theme.empty()) {
        if (v.complementType == 5) {
            // Verbes avec infinitif : utiliser le theme directement
            static const char* autourDuTheme[] = {
                "parler de {theme}",
                "en apprendre plus sur {theme}",
                "discuter de {theme} avec toi",
                "ecouter ce que tu racontes sur {theme}",
                "apprendre des choses sur {theme}",
                "comprendre {theme}",
                "reflechir a {theme}",
                "mediter sur {theme}",
                "reflechir au fait que {theme}",
                "te dire que {theme} c'est important"
            };
            complement = autourDuTheme[prochainIndice(10)];
            std::string::size_type q;
            while ((q = complement.find("{theme}")) != std::string::npos)
                complement.replace(q, 7, theme);
        }
        else if (v.complementType == 0) {
            // COD : integrer le theme comme complement
            int mode = prochainIndice(4);
            if (mode == 0) {
                complement = theme;
            } else if (mode == 1) {
                complement = "le " + theme;
            } else if (mode == 2) {
                complement = "la " + theme;
            } else {
                complement = "les " + theme;
            }
        }
        else if (v.complementType == 1) {
            // COI : "a" + theme
            complement = "a " + theme;
        }
        else if (v.complementType == 2) {
            // Lieu : si le theme est un lieu, l'utiliser ; sinon "a propos de {theme}"
            CategorieMot catTheme = categoriserMot(theme);
            if (catTheme == CAT_LIEU) {
                static const char* preps[] = {"a", "au", "dans", "sur", "chez"};
                std::string prep = preps[prochainIndice(5)];
                complement = prep + std::string(" ") + theme;
            } else {
                complement = std::string("a propos de ") + theme;
            }
        }
        else if (v.complementType == 3) {
            // Maniere : si le theme est un adjectif, l'utiliser ; sinon "avec {theme}"
            CategorieMot catTheme = categoriserMot(theme);
            if (catTheme == CAT_ADJECTIF) {
                complement = theme;
            } else {
                complement = std::string("avec ") + theme;
            }
        }
        else {
            // Fallback : integrer le theme
            complement = theme;
        }
    }
    // ===== FALLBACK : PAS DE THEME, UTILISER LE VOCABULAIRE =====
    else {
        if (v.complementType == 5) {
            static const char* infs[] = {
                "parler de ce qui te plait",
                "decouvrir des choses ensemble",
                "continuer a apprendre",
                "essayer de nouvelles choses",
                "en savoir plus sur tout et n'importe quoi"
            };
            complement = infs[prochainIndice(5)];
        }
        else {
            int r = prochainIndice(3);
            if (r == 0) {
                // Temps
                if (!vocabTemps.empty()) {
                    complement = vocabTemps[prochainIndice((int)vocabTemps.size())];
                }
                else {
                    static const char* tempsC[] = {
                        "ce matin", "ce soir", "cette nuit", "aujourd'hui", "demain",
                        "hier", "toute la journee", "toute la semaine", "tout le week-end",
                        "tout le mois", "toute l'annee", "en hiver", "au printemps",
                        "en ete", "en automne", "a 8 heures", "a midi", "a minuit",
                        "le lundi", "le week-end"
                    };
                    complement = tempsC[prochainIndice((int)(sizeof(tempsC) / sizeof(tempsC[0])))];
                }
            }
            else if (r == 1) {
                // Maniere
                if (!vocabAdj.empty()) {
                    complement = vocabAdj[prochainIndice((int)vocabAdj.size())];
                }
                else {
                    static const char* manieresC[] = {
                        "vite", "doucement", "fort", "bien", "mal", "ensemble",
                        "seul", "avec plaisir", "pour me reposer", "par amour"
                    };
                    complement = manieresC[prochainIndice((int)(sizeof(manieresC) / sizeof(manieresC[0])))];
                }
            }
            else if (v.complementType == 0) {
                // COD
                if (!vocabNoms.empty()) {
                    complement = vocabNoms[prochainIndice((int)vocabNoms.size())];
                }
                else {
                    static const char* cods[] = {
                        "une pomme", "du pain", "de l'eau", "un cafe", "un gateau",
                        "la television", "un film", "la musique", "une lettre", "un message",
                        "mon travail", "la maison", "la voiture", "la cle", "mon telephone",
                        "un livre", "un journal", "une douche", "le petit-dejeuner", "le diner",
                        "le repas", "la soupe", "les fruits", "du chocolat", "du vin",
                        "une erreur", "une decision", "mon enfant", "mon chien", "la verite",
                        "un game", "une serie", "un podcast", "une video", "une photo",
                        "un cadeau", "une surprise", "une idee", "un projet", "un reve",
                        "de la musique", "un bon repas", "un bon livre", "un bon cafe",
                        "quelque chose de bien", "quelque chose de special", "un moment cool"
                    };
                    complement = cods[prochainIndice((int)(sizeof(cods) / sizeof(cods[0])))];
                }
            }
            else if (v.complementType == 1) {
                // COI
                if (!vocabPersonnes.empty()) {
                    complement = "a " + vocabPersonnes[prochainIndice((int)vocabPersonnes.size())];
                }
                else {
                    static const char* cois[] = {
                        "a ma mere", "a mon pere", "a mon frere", "a ma soeur",
                        "a mon mari", "a ma femme", "a mes enfants", "a mon ami",
                        "a mon collegue", "au patron", "au medecin", "au professeur",
                        "a la caissiere", "au facteur", "a mes parents", "a tout le monde",
                        "a personne", "a quelqu'un", "a la vie", "a l'amour",
                        "a un(e) ami(e)", "a mon voisin", "a mon generaliste",
                        "a la radio", "a la tele", "aux infos", "aux nouvelles",
                        "a ceux qui savent", "a ceux qui ecoutent", "a toi"
                    };
                    complement = cois[prochainIndice((int)(sizeof(cois) / sizeof(cois[0])))];
                }
            }
            else if (v.complementType == 2) {
                // Lieu
                if (!vocabLieux.empty()) {
                    std::string lieu = vocabLieux[prochainIndice((int)vocabLieux.size())];
                    static const char* prep[] = {"a", "au", "dans", "sur", "chez", "vers", "pres de"};
                    std::string p = prep[prochainIndice(7)];
                    complement = p + " " + lieu;
                }
                else {
                    static const char* lieuxF[] = {
                        "a la maison", "au bureau", "a l'ecole", "au magasin", "dans la rue",
                        "au parc", "a la gare", "a la plage", "a la montagne",
                        "dans la cuisine", "dans le jardin", "dans la chambre", "dans le salon",
                        "sur la table", "sous le lit", "devant la porte", "derriere la voiture",
                        "entre les arbres", "chez moi", "en ville",
                        "au restaurant", "au cinema", "au musee", "a la bibliotheque",
                        "dans le tramway", "dans le metro", "a l'arret", "a l'aeroport",
                        "a la campagne", "dans la nature", "au bord de la mer",
                        "dans un cafe", "a la terrasse", "a la fenetre", "dans le noir",
                        "sous la pluie", "au soleil", "dans le vent"
                    };
                    complement = lieuxF[prochainIndice((int)(sizeof(lieuxF) / sizeof(lieuxF[0])))];
                }
            }
            else if (v.complementType == 3) {
                // Maniere
                if (!vocabAdj.empty()) {
                    complement = vocabAdj[prochainIndice((int)vocabAdj.size())];
                }
                else {
                    static const char* manieres[] = {
                        "vite", "doucement", "fort", "bien", "mal", "ensemble",
                        "seul", "avec plaisir", "pour me reposer", "par amour",
                        "avec passion", "en riant", "en pleurant", "en silence",
                        "avec soin", "sans effort", "de bonne humeur", "le coeur joyeux",
                        "tranquillement", "a la perfection", "comme un grand",
                        "en colere", "avec amour", "avec joie", "en famille",
                        "entre amis", "dans le calme", "sans stress", "a fond"
                    };
                    complement = manieres[prochainIndice((int)(sizeof(manieres) / sizeof(manieres[0])))];
                }
            }
            else {
                // Fallback
                if (!vocabAdj.empty() && prochainIndice(2) == 0) {
                    complement = vocabAdj[prochainIndice((int)vocabAdj.size())];
                }
                else if (!vocabNoms.empty()) {
                    complement = vocabNoms[prochainIndice((int)vocabNoms.size())];
                }
                else {
                    static const char* facons[] = {
                        "vite", "doucement", "fort", "bien", "mal", "ensemble",
                        "seul", "avec plaisir", "pour me reposer", "par amour"
                    };
                    complement = facons[prochainIndice((int)(sizeof(facons) / sizeof(facons[0])))];
                }
            }
        }
    }

    // "je sais en savoir plus" est redondant : on choisit une autre formule.
    if (verbe == "savoir" && complement.find("en savoir") != std::string::npos) {
        static const char* autres[] = {
            "comprendre ce qui t'interesse",
            "decouvrir ce qui te plait",
            "apprendre ce que tu aimes"
        };
        complement = autres[prochainIndice(3)];
    }

    // temps : present surtout, puis imparfait, futur, et un peu de conditionnel,
    // passe compose et plus-que-parfait pour varier les formes du bloc VERBE.
    int t = prochainIndice(10);
    int temps = (t < 5) ? 0 : (t == 5) ? 1 : (t == 6) ? 2 : (t == 7) ? 3
             : (t == 8) ? 4 : 5;

    static const char* intros[] = {
        "Tu sais, ", "Franchement, ", "En vrai, ", "Entre nous, ",
        "Honnetement, ", "C'est marrant mais ", "Pour le coup, ",
        "C'est fou, ", "Le truc c'est que ", "J'ai remarque que ",
        "ca me fait penser a ", "Au fond, ", "C'est bizarre mais ",
        "Vous savez quoi, ", "J'aime trop ca, ",
        "Petit a petit, ", "ca me rappelle que ", "Y'a un truc que je me dis souvent, ",
        "C'est drole parce que ", "J'y pensais souvent, ",
        "ca, c'est interessant, ", "Ce que j'adore, c'est ",
        "J'ai envie de te dire que ", "Si tu savais comme ",
        "Autrefois, je pensais que ", "Aujourd'hui, je me dis que ",
        "C'est pas toujours simple mais ", "D'habitude, je "
    };
    std::string phrase = std::string(intros[prochainIndice(28)]) + conjuguer(sujet, verbe, temps) + " " + complement;

    // cohesion : majuscule au debut, point a la fin
    if (!phrase.empty()) phrase[0] = (char)std::toupper((unsigned char)phrase[0]);
    if (phrase[phrase.size() - 1] != '.' && phrase[phrase.size() - 1] != '!' &&
        phrase[phrase.size() - 1] != '?')
        phrase += ".";
    return phrase;
}

// Alterne (a chaque appel) entre les deux facons de composer une phrase.

// Enregistre une connaissance (cle|reponse) dans savoir.txt, sans doublon.
// Si categorie >= 0, le mot-cle devient aussi un mot-cle de cette categorie
// (il declenchera le sujet dans toutes les conversations, meme chez les autres
// quand on partage le dossier). Retourne false si la cle etait deja connue.
// detection amelioree : verifie les doublons par distance de mots (pas juste
// l'egalite exacte) pour eviter les redondances ("foot" vs "football").
bool enregistrerSavoir(std::string cle, std::string rep, int categorie,
                       std::vector<std::string>& cles, std::vector<std::string>& reponses,
                       std::map<std::string, int>& motsClesAppris) {
    // le "|" est le separateur du fichier : on le retire pour ne pas corrompre savoir.txt
    for (unsigned int i = 0; i < cle.size(); i++) {
        if (cle[i] == '|') cle[i] = ' ';
    }
    for (unsigned int i = 0; i < rep.size(); i++) {
        if (rep[i] == '|') rep[i] = ' ';
    }
    // Nettoyage : retirer les articles et espaces en debut
    while (!cle.empty() && cle[0] == ' ') cle.erase(0, 1);
    while (!cle.empty() && cle[cle.size()-1] == ' ') cle.erase(cle.size()-1);
    while (!rep.empty() && rep[0] == ' ') rep.erase(0, 1);
    while (!rep.empty() && rep[rep.size()-1] == ' ') rep.erase(rep.size()-1);
    // Verifier les doublons (exact + flou)
    for (unsigned int i = 0; i < cles.size(); i++) {
        // Doublon exact (sans accents)
        if (sansAccents(cles[i]) == sansAccents(cle)) return false;
        // Doublon flou : si un mot-cle est contenu dans l'autre
        if (cles[i].size() >= 3 && cle.size() >= 3) {
            if (sansAccents(cles[i]).find(sansAccents(cle)) != std::string::npos ||
                sansAccents(cle).find(sansAccents(cles[i])) != std::string::npos) {
                // Si la reponse est aussi identique, c'est un doublon
                if (sansAccents(reponses[i]) == sansAccents(rep)) return false;
            }
        }
    }
    cles.push_back(cle);
    reponses.push_back(rep);
    bool avecCategorie = (categorie >= 0 && motsClesAppris.find(cle) == motsClesAppris.end());
    std::ofstream f("savoir.txt", std::ios::app | std::ios::binary);
    if (f.is_open()) {
        f << cle << "|" << rep;
        if (avecCategorie) f << "|" << categorie;
        f << "\r\n";
        f.close();
    }
    if (avecCategorie) motsClesAppris[cle] = categorie;
    return true;
}

// ============ HELPERS DE L'APPRENTISSAGE EVOLUTIF ============

// Mot courant (article, pronom, liaison...) qu'on ne retient pas comme mot-cle.
bool estMotCourant(const std::string& mot) {
    static const char* courants[] = {
        "avec", "sans", "dans", "pour", "par", "sur", "chez", "vers", "depuis",
        "pendant", "entre", "apres", "avant", "sous", "selon", "comme", "aussi",
        "alors", "enfin", "bien", "tout", "tous", "toute", "toutes", "plus",
        "moins", "tres", "trop", "assez", "peut", "peux", "pourquoi",
        "comment", "quand", "toujours", "jamais", "souvent", "parfois",
        "encore", "meme", "vraiment", "beaucoup", "quelque", "chaque",
        "plusieurs", "celui", "celle", "ceux", "celles", "non", "oui",
        "ouais", "nan", "pas", "est", "etre", "avoir", "faire",
        0
    };
    for (int i = 0; courants[i] != 0; i++) {
        if (mot == courants[i]) return true;
    }
    return false;
}

// Reecrit tout savoir.txt depuis la memoire (cles / reponses / mots-cles appris).
// Utile quand on remplace une reponse (correction ou definition plus complete).
void sauvegarderSavoir(const std::vector<std::string>& cles,
                       const std::vector<std::string>& reponses,
                       const std::map<std::string, int>& motsClesAppris) {
    std::ofstream f("savoir.txt", std::ios::binary);
    if (!f.is_open()) return;
    for (unsigned int i = 0; i < cles.size(); i++) {
        std::string cle = cles[i], rep = reponses[i];
        for (unsigned int j = 0; j < cle.size(); j++) if (cle[j] == '|') cle[j] = ' ';
        for (unsigned int j = 0; j < rep.size(); j++) if (rep[j] == '|') rep[j] = ' ';
        f << cle << "|" << rep;
        std::map<std::string, int>::const_iterator it = motsClesAppris.find(cles[i]);
        if (it != motsClesAppris.end()) f << "|" << it->second;
        f << "\r\n";
    }
    f.close();
}

// Reecrit tout profil.txt depuis la memoire (une ligne par fait sur l'utilisateur).
// Remplace l'ancien systeme qui ajoutait une ligne a chaque reponse (fichier infini).
void sauvegarderProfil(const std::map<std::string, std::string>& profil) {
    std::ofstream f("profil.txt", std::ios::binary);
    if (!f.is_open()) return;
    for (std::map<std::string, std::string>::const_iterator it = profil.begin(); it != profil.end(); ++it) {
        std::string rep = it->second;
        for (unsigned int j = 0; j < rep.size(); j++) if (rep[j] == '|') rep[j] = ' ';
        f << it->first << "|" << rep << "\r\n";
    }
    f.close();
}

// Enleve les formules de correction en debut de phrase
// ("non, c'est pas ca, tokyo c'est la capitale..." -> "tokyo c'est la capitale...").
// Renvoie true si la phrase commencait par une correction.
bool retirerCorrection(std::string& p) {
    static const char* marqueurs[] = {
        "non non", "nan", "non",
        "c'est pas ca", "c'est pas ça", "c est pas ca", "c pas ca", "c pas ça",
        "c'est faux", "c est faux", "pas du tout",
        "t'as tort", "t as tort", "tu te trompes", "tu as tort",
        "pas vrai", "c'est incorrect", "c est incorrect",
        "faux",
        0
    };
    bool correction = false;
    bool modifie = true;
    while (modifie) {
        modifie = false;
        while (!p.empty() && p[0] == ' ') p.erase(0, 1);
        while (!p.empty() && (p[0] == ',' || p[0] == ':' || p[0] == '.')) { p.erase(0, 1); modifie = true; }
        while (!p.empty() && p[0] == ' ') p.erase(0, 1);
        // "ca," / "ça," laisses seuls en tete apres une negation
        if (p.compare(0, 2, "ca") == 0) {
            if (p.size() == 2 || p[2] == ' ' || p[2] == ',' || p[2] == ':' || p[2] == '.') {
                p.erase(0, 2);
                correction = true;
                modifie = true;
                continue;
            }
        }
        if (p.compare(0, 3, "ça") == 0) {
            if (p.size() == 3 || p[3] == ' ' || p[3] == ',' || p[3] == ':' || p[3] == '.') {
                p.erase(0, 3);
                correction = true;
                modifie = true;
                continue;
            }
        }
        for (int i = 0; marqueurs[i] != 0; i++) {
            std::size_t n = std::strlen(marqueurs[i]);
            if (p.compare(0, n, marqueurs[i]) == 0) {
                p.erase(0, n);
                correction = true;
                modifie = true;
                break;
            }
        }
    }
    return correction;
}

// "c'est quoi un robot ?" -> "robot" (sujet de la question, sans article).
// Renvoie "" si ce n'est pas une question portant sur la definition d'un mot.
std::string extraireSujetQuestion(std::string p) {
    static const char* marqueurs[] = {
        "c'est quoi", "c est quoi", "c'est koi", "c quoi", "c koi",
        "que veut dire", "ca veut dire quoi", "ca veut dire", "ça veut dire",
        "c'est la definition de", "c est la definition de",
        "c'est le sens de", "c est le sens de",
        "quel est le sens de ce mot", "quel est le sens de",
        "quelle est la signification de",
        0
    };
    for (int i = 0; marqueurs[i] != 0; i++) {
        std::size_t n = std::strlen(marqueurs[i]);
        std::size_t pos = p.find(marqueurs[i]);
        if (pos == std::string::npos) continue;
        std::string s = p.substr(pos + n);
        while (!s.empty() && s[0] == ' ') s.erase(0, 1);
        while (!s.empty() && s[0] == '\'') s.erase(0, 1);
        while (!s.empty() && s[0] == ' ') s.erase(0, 1);
        // ponctuation finale
        while (!s.empty() && (s[s.size() - 1] == '?' || s[s.size() - 1] == '.' ||
                              s[s.size() - 1] == '!' || s[s.size() - 1] == ' ')) s.erase(s.size() - 1);
        // un article en tete
    static const char* articles[] = { "un ", "une ", "le ", "la ", "les ", "des ", "du ", "de ",
                                       "quel ", "quelle ", "quels ", "quelles " };
    for (int a = 0; a < 12; a++) {
        std::size_t la = std::strlen(articles[a]);
        if (s.compare(0, la, articles[a]) == 0) { s.erase(0, la); break; }
    }
    // un sujet trop court ("c'est quoi x ?") n'est pas une definition a retenir
    if (s.size() < 3) return "";
        // si le sujet commence par un mot personnel, c'est une question generale
        // ("c'est quoi ton nom ?"), pas une definition a retenir.
        static const char* personnels[] = {
            "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
            "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
            "notre", "votre", "leur", "leurs", "ce", "cette", "cet", "ces",
            "ca", "ca", "cela", "quoi", "comment", "pourquoi", "quand", "qui",
            "combien", "ou", "ou", "quelle", "quel", "quels", "quelles",
            "quelqu'un", "certains", "personne", "rien", "tout", "tous",
            0
        };
        std::string premier = s;
        for (unsigned int j = 0; j < s.size(); j++) {
            if (s[j] == ' ') { premier = s.substr(0, j); break; }
        }
        for (int k = 0; personnels[k] != 0; k++) {
            if (premier == personnels[k]) return "";
        }
        return s;
    }
    return "";
}

// L'alphabet que l'IA connait par coeur (minuscules et majuscules).
const char* alphabet = "abcdefghijklmnopqrstuvwxyz";
const char* alphabetMaj = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Nettoie une ligne lue dans un fichier : les fichiers enregistres sous Windows
// finissent par \r\n (std::getline laisse le \r), et le premier mot d'un fichier
// UTF-8 avec BOM commence par la marque EF BB BF. Sans ce nettoyage, les
// definitions et les mots de vocabulaire porteraient un \r parasite.
std::string nettoyerLigne(std::string s) {
    if (s.size() >= 3 && (unsigned char)s[0] == 0xEF &&
        (unsigned char)s[1] == 0xBB && (unsigned char)s[2] == 0xBF)
        s.erase(0, 3);
    while (!s.empty() && (s[s.size() - 1] == '\r' || s[s.size() - 1] == '\n' ||
                          s[s.size() - 1] == ' ')) s.erase(s.size() - 1);
    while (!s.empty() && s[0] == ' ') s.erase(0, 1);
    return s;
}

#ifdef _WIN32
// Tampon de sortie qui ecrit directement dans le descripteur Windows (WriteFile),
// sans passer par le tampon C (stdio). Avec MinGW, les ecritures via std::cout
// etaient parfois perdues quand stdout est un tuyau (pipe) : le serveur web ne
// recevait alors qu'une partie des reponses du bot.
class TamponSortie : public std::streambuf {
    HANDLE h;
public:
    explicit TamponSortie(HANDLE hh) : h(hh) {}
protected:
    int_type overflow(int_type c) override {
        if (c != traits_type::eof()) {
            char ch = (char)c;
            DWORD w = 0;
            WriteFile(h, &ch, 1, &w, NULL);
        }
        return traits_type::not_eof(c);
    }
    std::streamsize xsputn(const char* s, std::streamsize n) override {
        DWORD w = 0;
        WriteFile(h, s, (DWORD)n, &w, NULL);
        return w;
    }
    int sync() override { return 0; }
};
#endif

// "mode 1"/"mode 2" comme mots entiers, pas comme fragments : "mode 12",
// "le mode 1 des consoles" ou "uncmode 2" ne doivent pas changer de mode.
bool modeEnToutesLettres(const std::string& p, char numero) {
    std::string cible = std::string("mode ") + numero;
    std::size_t pos = 0;
    while ((pos = p.find(cible, pos)) != std::string::npos) {
        bool avantOk = pos == 0 || !((p[pos - 1] >= 'a' && p[pos - 1] <= 'z') || p[pos - 1] == '\'');
        std::size_t fin = pos + cible.size();
        bool apresOk = fin >= p.size() || !((p[fin] >= '0' && p[fin] <= '9') ||
                                            (p[fin] >= 'a' && p[fin] <= 'z'));
        if (avantOk && apresOk) return true;
        pos += cible.size();
    }
    return false;
}

// ============ DETECTION DE STRESS / FATIGUE ============
// Analyse le message pour detecter des signes de stress, agressivite ou confusion.
// Renvoie un score de 0 (calme) a 3 (fort stress).
int detecterStress(const std::string& p) {
    int score = 0;
    std::string pn = sansAccents(p);
    // Mots d'agressivite
    static const char* agressifs[] = {
        "ferme", "tais", "degage", "debile", "idiot", "nul", "minable",
        "emmerde", "casse", "va te faire", "salaud",
        "encule", "connard", "salop", "putain", "merde", "nique",
        0
    };
    for (int i = 0; agressifs[i] != 0; i++) {
        if (pn.find(agressifs[i]) != std::string::npos) { score += 2; break; }
    }
    // Trop de majuscules (cri)
    int maj = 0, total = 0;
    for (unsigned int i = 0; i < p.size(); i++) {
        if (p[i] >= 'a' && p[i] <= 'z') total++;
        if (p[i] >= 'A' && p[i] <= 'Z') { total++; maj++; }
    }
    if (total > 5 && maj > total * 0.6) score += 2;
    // Repetitions ("!!!", "???") = signe d'urgence
    for (unsigned int i = 0; i + 2 < p.size(); i++) {
        if (p[i] == p[i+1] && p[i] == p[i+2] && (p[i] == '!' || p[i] == '?'))
            { score++; break; }
    }
    // Mots de fatigue
    static const char* fatigues[] = {
        "fatigue", "epuise", "creve", "j'en peux plus", "j'ai plus la force",
        "je suis vide", "ca va pas", "je souffre", "je suis mal",
        "stress", "angoisse", "anxiete", "panique", "deprime",
        0
    };
    for (int i = 0; fatigues[i] != 0; i++) {
        if (pn.find(fatigues[i]) != std::string::npos) { score++; break; }
    }
    // Phrase tres courte + incomprehensible (confusion)
    if (p.size() < 6 && p.size() > 0) score++;
    if (score > 3) score = 3;
    return score;
}

// ============ DETECTION DE REFORMULATION ============
// Renvoie vrai si l'utilisateur demande qu'on reformule.
bool demandeReformulation(const std::string& p) {
    static const char* markers[] = {
        "j'ai pas compris", "j'ai pas bien compris", "je n'ai pas compris",
        "j'ai rien compris", "je n'ai rien compris", "c'est quoi",
        "tu peux expliquer", "reformule", "explique autrement",
        "en plus simple", "plus simple", "je comprends pas",
        "j pas compris", "pas compris",
        0
    };
    for (int i = 0; markers[i] != 0; i++) {
        if (p.find(markers[i]) != std::string::npos) return true;
    }
    return false;
}

// ============ DETECTION DE REQUETE DE RESUME ============
bool demandeResume(const std::string& p) {
    static const char* markers[] = {
        "resume", "resum", "recap", "recapitule",
        "qu'est-ce qu'on a dit", "qu'est ce qu'on a dit",
        "qu'on a parle", "de quoi on a parle",
        "quels etaient mes objectifs", "quel etaient mes objectifs",
        "mes objectifs", "mes buts", "mes ambitions",
        "ce qu'on s'est dit", "ce qu'on a dit",
        0
    };
    for (int i = 0; markers[i] != 0; i++) {
        if (p.find(markers[i]) != std::string::npos) return true;
    }
    return false;
}

// ============ DETECTION DE RAPPEL / OBJECTIF ============
// Detecte quand l'utilisateur fixe un objectif ou demande un rappel.
// "rappelle-moi de", "je dois", "il faut que je", "objectif".
bool detecteObjectif(const std::string& p, std::string& objectif) {
    static const char* markers[] = {
        "rappelle-moi de ", "rappelle moi de ",
        "rappelle-moi que ", "rappelle moi que ",
        "je dois ", "il faut que je ", "objectif :",
        "objectif ", "but : ", "but ",
        "n'oublie pas de ", "n oublie pas de ",
        0
    };
    for (int i = 0; markers[i] != 0; i++) {
        std::size_t pos = p.find(markers[i]);
        if (pos != std::string::npos) {
            objectif = p.substr(pos + std::strlen(markers[i]));
            while (!objectif.empty() && objectif[0] == ' ') objectif.erase(0, 1);
            while (!objectif.empty() && (objectif[objectif.size()-1] == '.' || objectif[objectif.size()-1] == '!' || objectif[objectif.size()-1] == '?'))
                objectif.erase(objectif.size()-1);
            return !objectif.empty();
        }
    }
    return false;
}

// ============ COMPREHENSION DES PHRASES ============
// Detecte le type de phrase et l'intention de l'utilisateur.
// p doit deja etre en minuscules sans accents (via minuscules/sansAccents).
// Retourne un code parmi : narration, besoin, jugement, comparaison, conseil,
// description, temporel, social, exclamation, doute, certitude, plainte,
// remerciement, blague, resolution, reformulation, "" (inconnu).
std::string detecterTypePhrase(const std::string& p) {

    // --- REMERCIEMENT (en priorite, car court et tres frequant) ---
    if (p.find("merci") != std::string::npos || p.find("c'est gentil") != std::string::npos ||
        p.find("t'es gentil") != std::string::npos || p.find("t es gentil") != std::string::npos ||
        p.find("je te remercie") != std::string::npos || p.find("thanks") != std::string::npos)
        return "remerciement";

    // --- PLAINTE / FRUSTRATION ---
    if (p.find("m'enerve") != std::string::npos || p.find("m enerve") != std::string::npos ||
        p.find("j'en ai marre") != std::string::npos || p.find("j en ai marre") != std::string::npos ||
        p.find("c'est relou") != std::string::npos || p.find("c est relou") != std::string::npos ||
        p.find("c'est degoutant") != std::string::npos || p.find("c'est n'importe quoi") != std::string::npos ||
        p.find("c est n importe quoi") != std::string::npos || p.find("je suis en colere") != std::string::npos ||
        p.find("ca me saoule") != std::string::npos || p.find("je supporte plus") != std::string::npos ||
        p.find("c'est injuste") != std::string::npos || p.find("j'ai horreur") != std::string::npos ||
        p.find("je kiffe pas") != std::string::npos || p.find("ca me saoule") != std::string::npos)
        return "plainte";

    // --- BLAGUE / HUMOUR ---
    if (p.find("je rigole") != std::string::npos || p.find("c'est une blague") != std::string::npos ||
        p.find("c est une blague") != std::string::npos || p.find("t'as la ref") != std::string::npos ||
        p.find("t as la ref") != std::string::npos || p.find("lol") != std::string::npos ||
        p.find("mdr") != std::string::npos || p.find("ptdr") != std::string::npos ||
        p.find("haha") != std::string::npos || p.find("blague") != std::string::npos ||
        p.find("c'est drole") != std::string::npos || p.find("c est drole") != std::string::npos)
        return "blague";

    // --- EXCLAMATION / SURPRISE ---
    if (p.find("wahou") != std::string::npos || p.find("wow") != std::string::npos ||
        p.find("oh la la") != std::string::npos || p.find("oh mon dieu") != std::string::npos ||
        p.find("c'est fou") != std::string::npos || p.find("c est fou") != std::string::npos ||
        p.find("c'est dingue") != std::string::npos || p.find("c'est ouf") != std::string::npos ||
        p.find("c est ouf") != std::string::npos || p.find("pas possible") != std::string::npos ||
        p.find("incroyable") != std::string::npos || p.find("je suis mort") != std::string::npos ||
        p.find("sans blague") != std::string::npos)
        return "exclamation";

    // --- DOUTE / INCERTITUDE ---
    if (p.find("je sais pas") != std::string::npos || p.find("j'sais pas") != std::string::npos ||
        p.find("j sais pas") != std::string::npos || p.find("je ne sais pas") != std::string::npos ||
        p.find("bof") != std::string::npos || p.find("peut-etre") != std::string::npos ||
        p.find("peut etre") != std::string::npos || p.find("j'suis pas sur") != std::string::npos ||
        p.find("je suis pas sur") != std::string::npos || p.find("aucune idee") != std::string::npos ||
        p.find("j'ai un doute") != std::string::npos || p.find("j ai un doute") != std::string::npos ||
        p.find("pas sur") != std::string::npos || p.find("je doute") != std::string::npos)
        return "doute";

    // --- CERTITUDE / CONVICTION ---
    if (p.find("je suis sur") != std::string::npos || p.find("je suis certain") != std::string::npos ||
        p.find("c'est certain") != std::string::npos || p.find("c est certain") != std::string::npos ||
        p.find("sans aucun doute") != std::string::npos || p.find("absolument") != std::string::npos ||
        p.find("forcement") != std::string::npos || p.find("c'est evident") != std::string::npos ||
        p.find("c est evident") != std::string::npos || p.find("nul doute") != std::string::npos)
        return "certitude";

    // --- RESOLUTION / ENGAGEMENT ---
    if (p.find("je vais essayer") != std::string::npos || p.find("je vais faire") != std::string::npos ||
        p.find("je compte bien") != std::string::npos || p.find("c'est decide") != std::string::npos ||
        p.find("c est decide") != std::string::npos || p.find("je m'y mets") != std::string::npos ||
        p.find("c'est pour bientot") != std::string::npos || p.find("je commence demain") != std::string::npos ||
        p.find("c'est parti") != std::string::npos || p.find("allons-y") != std::string::npos ||
        p.find("j'y vais") != std::string::npos || p.find("on y va") != std::string::npos)
        return "resolution";

    // --- REFORMULATION / EXPLICATION ---
    if (p.find("en gros") != std::string::npos || p.find("en resume") != std::string::npos ||
        p.find("autrement dit") != std::string::npos || p.find("c'est-a-dire") != std::string::npos ||
        p.find("c'est a dire") != std::string::npos || p.find("pour faire simple") != std::string::npos ||
        p.find("disons que") != std::string::npos || p.find("comprends pas") != std::string::npos ||
        p.find("je comprends pas") != std::string::npos || p.find("pas compris") != std::string::npos)
        return "reformulation";

    // --- NARRATION / HISTOIRE ---
    if (p.find("je suis alle") != std::string::npos || p.find("j'ai fait") != std::string::npos ||
        p.find("j ai fait") != std::string::npos || p.find("il s'est passe") != std::string::npos ||
        p.find("il s est passe") != std::string::npos || p.find("on est alle") != std::string::npos ||
        p.find("c'etait") != std::string::npos || p.find("s'est passe") != std::string::npos ||
        p.find("s est passe") != std::string::npos || p.find("je raconte") != std::string::npos ||
        p.find("devine") != std::string::npos || p.find("tu sais quoi") != std::string::npos ||
        p.find("j'ai vu") != std::string::npos || p.find("j ai vu") != std::string::npos ||
        p.find("j'ai rencontre") != std::string::npos || p.find("on a fait") != std::string::npos ||
        p.find("on a dit") != std::string::npos || p.find("je me rappelle") != std::string::npos ||
        p.find("je me souviens") != std::string::npos)
        return "narration";

    // --- BESOIN / DESIR ---
    if (p.find("je veux") != std::string::npos || p.find("j'ai besoin") != std::string::npos ||
        p.find("j ai besoin") != std::string::npos || p.find("je cherche") != std::string::npos ||
        p.find("je dois") != std::string::npos || p.find("il faut que") != std::string::npos ||
        p.find("j'aimerais") != std::string::npos || p.find("je voudrais") != std::string::npos ||
        p.find("j'ai envie") != std::string::npos || p.find("j ai envie") != std::string::npos ||
        p.find("il me faut") != std::string::npos || p.find("je recherche") != std::string::npos ||
        p.find("j'essaie de") != std::string::npos || p.find("j essaie de") != std::string::npos ||
        p.find("besoin de") != std::string::npos)
        return "besoin";

    // --- JUGEMENT / EVALUATION ---
    if (p.find("c'est bien") != std::string::npos || p.find("c est bien") != std::string::npos ||
        p.find("c'est nul") != std::string::npos || p.find("c est nul") != std::string::npos ||
        p.find("c'est genial") != std::string::npos || p.find("c'est moche") != std::string::npos ||
        p.find("c'est beau") != std::string::npos || p.find("c'est laid") != std::string::npos ||
        p.find("c'est cool") != std::string::npos || p.find("c'est naze") != std::string::npos ||
        p.find("j'adore") != std::string::npos || p.find("je deteste") != std::string::npos ||
        p.find("je kiffe") != std::string::npos || p.find("j'aime bien") != std::string::npos ||
        p.find("j aime bien") != std::string::npos || p.find("c'est pas mal") != std::string::npos ||
        p.find("c'est top") != std::string::npos || p.find("c'est parfait") != std::string::npos ||
        p.find("c'est classe") != std::string::npos || p.find("c'est sympa") != std::string::npos)
        return "jugement";

    // --- COMPARAISON ---
    if (p.find("mieux que") != std::string::npos || p.find("moins que") != std::string::npos ||
        p.find("je prefere") != std::string::npos || p.find("plutot que") != std::string::npos ||
        (p.find("comme") != std::string::npos && p.find("mieux") != std::string::npos) ||
        p.find("superieur a") != std::string::npos || p.find("inferieur a") != std::string::npos ||
        p.find("different de") != std::string::npos || p.find("similaire a") != std::string::npos)
        return "comparaison";

    // --- CONSEIL / DEMANDE D'AVIS ---
    if (p.find("je devrais") != std::string::npos || p.find("tu crois que") != std::string::npos ||
        p.find("tu penses que") != std::string::npos || p.find("qu'est-ce que tu") != std::string::npos ||
        p.find("tu penses quoi") != std::string::npos || p.find("conseil") != std::string::npos ||
        p.find("tu me conseilles") != std::string::npos || p.find("t'en penses quoi") != std::string::npos ||
        p.find("ton avis") != std::string::npos || p.find("tu ferais quoi") != std::string::npos ||
        p.find("j'hesite entre") != std::string::npos || p.find("j hesite entre") != std::string::npos)
        return "conseil";

    // --- DESCRIPTION / EXPLICATION ---
    if (p.find("c'est un") != std::string::npos || p.find("c'est une") != std::string::npos ||
        p.find("il est") != std::string::npos || p.find("elle est") != std::string::npos ||
        p.find("c'est le") != std::string::npos || p.find("c'est la") != std::string::npos ||
        p.find("c'est comme") != std::string::npos || p.find("ressemble a") != std::string::npos ||
        p.find("ca veut dire") != std::string::npos)
        return "description";

    // --- TEMPOREL ---
    if (p.find("hier") != std::string::npos || p.find("aujourd'hui") != std::string::npos ||
        p.find("demain") != std::string::npos || p.find("ce matin") != std::string::npos ||
        p.find("cette nuit") != std::string::npos || p.find("la semaine prochaine") != std::string::npos ||
        p.find("la semaine derniere") != std::string::npos || p.find("le mois prochain") != std::string::npos ||
        p.find("il y a") != std::string::npos || p.find("apres-demain") != std::string::npos ||
        p.find("avant-hier") != std::string::npos)
        return "temporel";

    // --- SOCIAL ---
    if (p.find("avec mes amis") != std::string::npos || p.find("en famille") != std::string::npos ||
        p.find("au travail") != std::string::npos || p.find("avec mes copains") != std::string::npos ||
        p.find("a l'ecole") != std::string::npos || p.find("avec mon") != std::string::npos ||
        p.find("avec ma") != std::string::npos || p.find("entre amis") != std::string::npos ||
        p.find("mes potes") != std::string::npos || p.find("mes collegues") != std::string::npos)
        return "social";

    return "";
}

// ============ DETECTION DE CONTENU NEGATIF / INCORRECT / MAUVAIS ============
// Detecte quand l'utilisateur dit quelque chose de mauvais, d'incorrect,
// de nuisible ou de mal conseille. Le bot ne doit pas encourager ce comportement.
// Retourne la categorie de critique : "nuisible", "violence", "drogue",
// "mensonge", "egoisme", "paresse", "mauvais", "respect", "incorrect", ou "".
std::string detecterCritique(const std::string& p) {
    std::string pa = sansAccents(minuscules(p));

    // --- Violence / agression physique ---
    if (pa.find("tuer") != std::string::npos || pa.find("meurtre") != std::string::npos ||
        pa.find("assassiner") != std::string::npos || pa.find("homicide") != std::string::npos ||
        pa.find("frapper") != std::string::npos || pa.find("battre") != std::string::npos ||
        pa.find("violence") != std::string::npos || pa.find("agresser") != std::string::npos ||
        pa.find("attaquer") != std::string::npos || pa.find("molester") != std::string::npos ||
        pa.find("taper") != std::string::npos || pa.find(" gifler") != std::string::npos ||
        pa.find("poignarder") != std::string::npos || pa.find("tirer") != std::string::npos ||
        pa.find("pendre") != std::string::npos || pa.find("noyer") != std::string::npos ||
        pa.find("bruler vif") != std::string::npos || pa.find("enterer vivant") != std::string::npos ||
        pa.find("torturer") != std::string::npos || pa.find(" mutiler") != std::string::npos ||
        pa.find("casser les os") != std::string::npos || pa.find("blesser") != std::string::npos ||
        pa.find("detruire") != std::string::npos || pa.find("demolir") != std::string::npos ||
        pa.find("saccager") != std::string::npos || pa.find("pillier") != std::string::npos ||
        pa.find("racketter") != std::string::npos || pa.find("braquer") != std::string::npos ||
        pa.find("mettre a feu") != std::string::npos || pa.find(" incendie") != std::string::npos)
        return "violence";

    // --- Drogues / substances dangereuses ---
    if (pa.find("drogue") != std::string::npos || pa.find("drugs") != std::string::npos ||
        pa.find("cannabis") != std::string::npos || pa.find("heroin") != std::string::npos ||
        pa.find("cocaine") != std::string::npos || pa.find("crack") != std::string::npos ||
        pa.find("meth") != std::string::npos || pa.find("ecstasy") != std::string::npos ||
        pa.find("lsd") != std::string::npos || pa.find("heroique") != std::string::npos ||
        pa.find("overdose") != std::string::npos || pa.find("surdose") != std::string::npos ||
        pa.find("tabac") != std::string::npos || pa.find("cigarette") != std::string::npos ||
        pa.find("cigar") != std::string::npos || pa.find("pipe") != std::string::npos ||
        pa.find("joint") != std::string::npos || pa.find("beuh") != std::string::npos ||
        pa.find("fumer") != std::string::npos || pa.find("tchernobyl") != std::string::npos ||
        pa.find("sniffer") != std::string::npos || pa.find("injecter") != std::string::npos ||
        pa.find("shoot") != std::string::npos || pa.find("dealer") != std::string::npos ||
        pa.find(" trafiquer") != std::string::npos)
        return "drogue";

    // --- Nuisible / danger general ---
    if (pa.find("voler") != std::string::npos || pa.find(" vol ") != std::string::npos ||
        pa.find("escroquer") != std::string::npos || pa.find("arnaque") != std::string::npos ||
        pa.find("arnaquer") != std::string::npos || pa.find("fourguer") != std::string::npos ||
        pa.find("escroquerie") != std::string::npos || pa.find("fraude") != std::string::npos ||
        pa.find("frauder") != std::string::npos || pa.find("corrompre") != std::string::npos ||
        pa.find("corruption") != std::string::npos || pa.find("blackmailer") != std::string::npos ||
        pa.find("chantage") != std::string::npos || pa.find("menacer") != std::string::npos ||
        pa.find("menace") != std::string::npos || pa.find("intimider") != std::string::npos ||
        pa.find("intimidation") != std::string::npos || pa.find("empoisonner") != std::string::npos ||
        pa.find("empoisonnement") != std::string::npos || pa.find("nuire") != std::string::npos ||
        pa.find("saboter") != std::string::npos || pa.find("sabotage") != std::string::npos ||
        pa.find("catastrophe") != std::string::npos || pa.find("accident volontaire") != std::string::npos ||
        pa.find("mettre en danger") != std::string::npos || pa.find("risquer la vie") != std::string::npos ||
        pa.find("jouer avec le feu") != std::string::npos || pa.find("jouer avec la mort") != std::string::npos)
        return "nuisible";

    // --- Mensonge / tricherie ---
    if (pa.find("mentir") != std::string::npos || pa.find("menteur") != std::string::npos ||
        pa.find("mensonge") != std::string::npos || pa.find("tromper") != std::string::npos ||
        pa.find("tromperie") != std::string::npos || pa.find("tricher") != std::string::npos ||
        pa.find("triche") != std::string::npos || pa.find("tricherie") != std::string::npos ||
        pa.find("copier") != std::string::npos || pa.find("copie") != std::string::npos ||
        pa.find("plagier") != std::string::npos || pa.find("plagiat") != std::string::npos ||
        pa.find("voler le travail") != std::string::npos || pa.find("usurper") != std::string::npos ||
        pa.find("faux document") != std::string::npos || pa.find("fausse carte") != std::string::npos ||
        pa.find("fausse identite") != std::string::npos || pa.find("faux certificat") != std::string::npos ||
        pa.find("faux papiers") != std::string::npos || pa.find("fausse monnaie") != std::string::npos ||
        pa.find("jouer avec les gens") != std::string::npos || pa.find("abuser de la confiance") != std::string::npos ||
        pa.find("manipuler") != std::string::npos || pa.find("manipulation") != std::string::npos ||
        pa.find("leurrer") != std::string::npos || pa.find("duper") != std::string::npos ||
        pa.find("leurre") != std::string::npos)
        return "mensonge";

    // --- Egoisme / indifference ---
    if (pa.find("peu m'importe") != std::string::npos || pa.find("ca me file") != std::string::npos ||
        pa.find("j'en ai rien a faire") != std::string::npos || pa.find("je m'en fous") != std::string::npos ||
        pa.find("je m'en tape") != std::string::npos || pa.find("je m'en moque") != std::string::npos ||
        pa.find("les autres c'est pas mon probleme") != std::string::npos ||
        pa.find("qu'ils se debrouillent") != std::string::npos || pa.find("pas mon circuit") != std::string::npos ||
        pa.find("je pense qu'a moi") != std::string::npos || pa.find("les autres m'interessent pas") != std::string::npos ||
        pa.find("rien a foutre") != std::string::npos || pa.find("rien a faire") != std::string::npos ||
        pa.find("ca m'est egalement") != std::string::npos || pa.find("bof") != std::string::npos ||
        pa.find("je m'en contrefous") != std::string::npos || pa.find("peu importe") != std::string::npos)
        return "egoisme";

    // --- Paresse / abandon / demotivation ---
    if (pa.find("j'abandonne") != std::string::npos || pa.find("c'est trop dur") != std::string::npos ||
        pa.find("j'arrete") != std::string::npos || pa.find("je veux plus rien faire") != std::string::npos ||
        pa.find("flemme") != std::string::npos || pa.find("j'ai pas envie") != std::string::npos ||
        pa.find("ca sert a rien") != std::string::npos || pa.find("c'est inutile") != std::string::npos ||
        pa.find("je baisse les bras") != std::string::npos || pa.find("laisse tomber") != std::string::npos ||
        pa.find("c'est mort") != std::string::npos || pa.find("j'ai la flemme") != std::string::npos ||
        pa.find("je quitte") != std::string::npos || pa.find("j'eteins tout") != std::string::npos ||
        pa.find("c'est fini pour moi") != std::string::npos || pa.find("plus envie") != std::string::npos ||
        pa.find("je me rends") != std::string::npos || pa.find("c'est perdu d'avance") != std::string::npos ||
        pa.find("j'ai plus de force") != std::string::npos || pa.find("je cale") != std::string::npos ||
        pa.find("je n'en peux plus") != std::string::npos || pa.find("j'en peux plus") != std::string::npos ||
        pa.find("c'est galere") != std::string::npos || pa.find("c'est relou") != std::string::npos)
        return "paresse";

    // --- Mauvais comportement social / disrespect ---
    if (pa.find("insulter") != std::string::npos || pa.find("offenser") != std::string::npos ||
        pa.find("humilier") != std::string::npos || pa.find("moquer") != std::string::npos ||
        pa.find("ridiculiser") != std::string::npos || pa.find("exclure") != std::string::npos ||
        pa.find("isoler quelqu'un") != std::string::npos || pa.find("rabaisser") != std::string::npos ||
        pa.find("denigrer") != std::string::npos || pa.find("dire du mal") != std::string::npos ||
        pa.find("critiquer sans raison") != std::string::npos || pa.find("narguer") != std::string::npos ||
        pa.find("embeter") != std::string::npos || pa.find("harceler") != std::string::npos ||
        pa.find("harclement") != std::string::npos || pa.find("brimader") != std::string::npos ||
        pa.find("brimade") != std::string::npos || pa.find("tyranniser") != std::string::npos ||
        pa.find("tyran") != std::string::npos || pa.find("dominer") != std::string::npos ||
        pa.find("asservir") != std::string::npos || pa.find("oppresser") != std::string::npos ||
        pa.find("oppression") != std::string::npos || pa.find("marginaliser") != std::string::npos ||
        pa.find("bouc emissaire") != std::string::npos || pa.find("lyncher") != std::string::npos ||
        pa.find("pourchasser") != std::string::npos || pa.find("persecuter") != std::string::npos)
        return "mauvais";

    // --- Manque de respect / grossierete ---
    if (pa.find("ferme ta gueule") != std::string::npos || pa.find("ferme") != std::string::npos ||
        pa.find("tais toi") != std::string::npos || pa.find("degage") != std::string::npos ||
        pa.find("va te faire") != std::string::npos || pa.find("encule") != std::string::npos ||
        pa.find("connard") != std::string::npos || pa.find("salope") != std::string::npos ||
        pa.find("pute") != std::string::npos || pa.find("salaud") != std::string::npos ||
        pa.find("encule") != std::string::npos || pa.find("fdp") != std::string::npos ||
        pa.find("nique") != std::string::npos || pa.find("ta mere") != std::string::npos ||
        pa.find("gros con") != std::string::npos || pa.find("idiot") != std::string::npos ||
        pa.find("debile") != std::string::npos || pa.find("nul") != std::string::npos ||
        pa.find("minable") != std::string::npos || pa.find("zerable") != std::string::npos ||
        pa.find("abruti") != std::string::npos || pa.find("imbecile") != std::string::npos ||
        pa.find("stupide") != std::string::npos || pa.find("demeure") != std::string::npos ||
        pa.find("garnement") != std::string::npos || pa.find("faineant") != std::string::npos ||
        pa.find("vaurien") != std::string::npos)
        return "respect";

    // --- Incorrection / fausse information ---
    if (pa.find("la terre est plate") != std::string::npos ||
        pa.find("le soleil tourne") != std::string::npos ||
        pa.find("2+2=5") != std::string::npos || pa.find("deux et deux font cinq") != std::string::npos ||
        pa.find("la lune est un fromage") != std::string::npos ||
        pa.find("les dinosaures n'existent pas") != std::string::npos ||
        pa.find("c'est pas vrai") != std::string::npos || pa.find("c'est faux") != std::string::npos ||
        pa.find("c'est incorrect") != std::string::npos || pa.find("c'est pas correct") != std::string::npos ||
        pa.find("c'est pas bien") != std::string::npos || pa.find("c'est mauvais") != std::string::npos ||
        pa.find("c'est nul") != std::string::npos || pa.find("c'est naze") != std::string::npos ||
        pa.find("c'est n'importe quoi") != std::string::npos || pa.find("c'est de la merde") != std::string::npos ||
        pa.find("c'est de la mort") != std::string::npos || pa.find("c'est de la daube") != std::string::npos ||
        pa.find("c'est pourri") != std::string::npos || pa.find("c'est nul et non") != std::string::npos ||
        pa.find("ca sert a rien") != std::string::npos || pa.find("c'est perdu") != std::string::npos)
        return "incorrect";

    return "";
}

// Reponse de critique quand le bot detecte un contenu mauvais, incorrect ou nuisible.
// Le bot n'encourage PAS et propose une correction ou un recadrage.
// La reponse est COHERENTE avec ce que l'utilisateur a dit.
std::string reponseCritique(const std::string& categorie, const std::string& phrase) {
    std::string pa = sansAccents(minuscules(phrase));

    // --- Violence / agression ---
    if (categorie == "violence") {
        std::string motCle = "";
        static const char* motsViolence[] = {
            "tuer", "meurtre", "assassiner", "frapper", "battre", "violence",
            "agresser", "attaquer", "poignarder", "tirer", "pendre", "noyer",
            "torturer", "blesser", "detruire", "demolir", "casser", "bruler",
            "molester", "mutiler", 0
        };
        for (int i = 0; motsViolence[i] != 0; i++) {
            if (pa.find(motsViolence[i]) != std::string::npos) {
                motCle = motsViolence[i];
                break;
            }
        }
        if (!motCle.empty()) {
            std::string r[] = {
                "Tu parles de \"" + motCle + "\" mais c'est inacceptable. La violence ne resout jamais rien.",
                "Le \"" + motCle + "\", c'est gravissime. Tu peux faire du mal a des gens innocents.",
                "Arrete avec le \"" + motCle + "\", c'est pas une solution. Parle, discute, mais fais pas de mal.",
                "Le \"" + motCle + "\", ca finit toujours mal. Pour toi et pour les autres.",
                "Je refuse d'encourager le \"" + motCle + "\". C'est dangereux et c'est interdit.",
                "Le \"" + motCle + "\", c'est de la folie. Respire et trouve une solution pacifique.",
                "Tu realises ce que tu dis avec le \"" + motCle + "\" ? C'est terrible. Ne fais pas ca.",
                "Le \"" + motCle + "\", c'est la pire option. Tu vas ruiner des vies, y compris la tienne.",
                "Faut pas songer au \"" + motCle + "\", c'est interdit et c'est mal.",
                "Le \"" + motCle + "\", ca cree que du malheur. Il y a toujours une solution pacifique."
            };
            return r[prochainIndice(10)];
        }
        std::string r[] = {
            "La violence, c'est jamais la reponse. Parle plutot, ca avancera plus.",
            "Tu peux pas regler les choses en etant violent. Discute, c'est mieux.",
            "La force brutale, c'est pas bien. La douceur et la patience, ca marche mieux.",
            "Arrete, la violence ca fait que du mal. Trouve une solution pacifique.",
            "Frapper ou attaquer, c'est pas acceptable. Choisir le dialogue.",
            "La violence est toujours un echec. Essaie la diplomatie a la place.",
            "Tu veux etre violent ? Non, c'est pas la bonne maniere. Calme-toi.",
            "On ne resout rien par la violence. La parole, c'est plus fort que les coups.",
            "La violence cree la violence. Arrete la chaine et sois plus sage.",
            "Meme si t'es en colere, la violence c'est pas la reponse. Controle-toi."
        };
        return r[prochainIndice(10)];
    }

    // --- Drogues / substances ---
    if (categorie == "drogue") {
        std::string motCle = "";
        static const char* motsDrogue[] = {
            "drogue", "cannabis", "heroin", "cocaine", "crack", "meth",
            "ecstasy", "lsd", "overdose", "surdose", "tabac", "cigarette",
            "joint", "fumer", "sniffer", "dealer", "trafiquer", 0
        };
        for (int i = 0; motsDrogue[i] != 0; i++) {
            if (pa.find(motsDrogue[i]) != std::string::npos) {
                motCle = motsDrogue[i];
                break;
            }
        }
        if (!motCle.empty()) {
            std::string r[] = {
                "Tu parles du \"" + motCle + "\", mais c'est dangereux pour ta sante. Ca detruit le corps et l'esprit.",
                "Le \"" + motCle + "\", c'est un piege. Tu commences pour le fun et tu finis accro.",
                "Fais pas ca avec le \"" + motCle + "\", c'est nocif. Ta vie vaut mieux que ca.",
                "Le \"" + motCle + "\", ca fait du mal a long terme. Pour ta sante, eloigne-toi.",
                "Arrete avec le \"" + motCle + "\", c'est mauvais pour toi. Tu peux vivre mieux sans.",
                "Le \"" + motCle + "\", c'est pas une solution a quoi que ce soit. C'est un probleme en plus.",
                "Je te deconseille fortement le \"" + motCle + "\". Ca ruinera ta vie petit a petit.",
                "Le \"" + motCle + "\", c'est destructeur. Y'a de meilleurs moyens de passer le temps.",
                "Faut pas toucher au \"" + motCle + "\", c'est vicieux. Un seul essai peut tout changer.",
                "La drogue, ca t'enchaine. Libere-toi en n'en faisant pas usage."
            };
            return r[prochainIndice(10)];
        }
        std::string r[] = {
            "Les drogues, c'est dangereux. Ca peut te rendre malade et dependant. Evite ca.",
            "Fumer ou consommer des substances, c'est mauvais pour ta sante. Protege-toi.",
            "La drogue, c'est pas un jeu. Ca tue des gens tous les jours. Fais attention.",
            "Tu veux consommer ? Non, c'est pas bon. Prends soin de toi.",
            "Les substances, ca detruit des vies. Ne commence meme pas.",
            "La drogue, c'est un cercle vicieux. Tu sors plus facilement que tu n'entres.",
            "Ta sante est importante. Les drogues, c'est l'ennemi. Fais gaffe.",
            "Consommer, c'est risquer sa vie. Y'a tellement de raisons de pas le faire.",
            "La dependance, c'est terrible. Ne joue pas avec ca.",
            "Les drogues, ca vole des annees de vie. Garde les tiennes."
        };
        return r[prochainIndice(10)];
    }

    // --- Nuisible / danger general ---
    if (categorie == "nuisible") {
        std::string motCle = "";
        static const char* motsNuisibles[] = {
            "voler", "vol", "escroquer", "arnaque", "arnaquer", "fraude",
            "frauder", "corrompre", "corruption", "chantage", "menacer",
            "menace", "intimider", "empoisonner", "saboter", "nuire",
            "mettre en danger", "jouer avec le feu", 0
        };
        for (int i = 0; motsNuisibles[i] != 0; i++) {
            if (pa.find(motsNuisibles[i]) != std::string::npos) {
                motCle = motsNuisibles[i];
                break;
            }
        }
        if (!motCle.empty()) {
            std::string r[] = {
                "Tu parles de \"" + motCle + "\" mais c'est pas une bonne idee. Ca peut vraiment faire du mal.",
                "Le \"" + motCle + "\", c'est dangereux. Y'a toujours une meilleure solution que ca.",
                "Je comprends que tu penses au \"" + motCle + "\", mais c'est pas la bonne facon.",
                "Parler de \"" + motCle + "\", c'est pas cool. Essaie de trouver quelque chose de positif.",
                "Le \"" + motCle + "\", c'est pas bien. Tu peux trouver mieux, j'en suis sur.",
                "Arrete avec le \"" + motCle + "\", c'est pas bon pour toi ni pour les autres.",
                "Le \"" + motCle + "\", ca finit jamais bien. Pense a des alternatives plus douces.",
                "Je te deconseille le \"" + motCle + "\". Ca nuit et ca resout rien.",
                "Le \"" + motCle + "\", c'est une mauvaise pente. Retourne-toi avant que ca empire.",
                "Fais pas ca, le \"" + motCle + "\" est nuisible. Y'a des choses bien meilleures a faire."
            };
            return r[prochainIndice(10)];
        }
        std::string r[] = {
            "Ce que tu dis la c'est pas top. Ca peut faire du mal aux gens, non ?",
            "Je pense pas que ce soit une bonne idee. Y'a toujours une meilleure solution.",
            "Ca, c'est pas bien. On peut trouver moyen de regler les choses sans en arriver la.",
            "Je te conseille pas du tout ca. Ca finit rarement bien, tu sais.",
            "C'est dangereux et c'est pas cool. Essaie de trouver une solution plus peaceful.",
            "Non non non, ca c'est pas la bonne facon de faire. Respire et reflechis un peu.",
            "Fais pas ca, c'est pas bien. Tu peux trouver mieux, j'en suis sur.",
            "Arrete, c'est pas bien ce que tu proposes. Y'a toujours une solution plus douce.",
            "C'est nuisible. Reflechis aux consequences avant de dire ou faire quelque chose.",
            "Ca va cree des problemes. Choisis quelque chose de moins dangereux."
        };
        return r[prochainIndice(10)];
    }

    // --- Mensonge / tricherie ---
    if (categorie == "mensonge") {
        std::string motCle = "";
        static const char* motsMensonge[] = {
            "mentir", "menteur", "mensonge", "tromper", "tricher", "triche",
            "copier", "plagier", "plagiat", "faux document", "fausse carte",
            "fausse identite", "manipuler", "manipulation", "leurrer", "duper", 0
        };
        for (int i = 0; motsMensonge[i] != 0; i++) {
            if (pa.find(motsMensonge[i]) != std::string::npos) {
                motCle = motsMensonge[i];
                break;
            }
        }
        if (!motCle.empty()) {
            std::string r[] = {
                "Tu parles de \"" + motCle + "\" mais c'est pas bien. Les gens finissent toujours par savoir.",
                "Le \"" + motCle + "\", c'est pas cool. La verite, c'est toujours mieux.",
                "Ca avec le \"" + motCle + "\", ca finit par se savoir. Sois honnete.",
                "Tricher ou mentir, c'est pas top. Tu seras plus fier en faisant les choses bien.",
                "Les mensonges, ca se retoune toujours contre toi. Sois sincere.",
                "Copier ou tricher, ca t'apprend rien. Apprends et tu seras plus fort.",
                "La confiance, c'est dur a reconstruire une fois perdue. Evite le \"" + motCle + "\".",
                "Mentir, c'est le meilleur moyen de perdre tes amis. Reste vrai.",
                "Le \"" + motCle + "\", ca detruit la confiance. Sans confiance, y'a plus rien.",
                "Arrete de \"" + motCle + "\", c'est malhonnete. Assume ce que tu penses vraiment."
            };
            return r[prochainIndice(10)];
        }
        std::string r[] = {
            "Mentir, c'est pas bien. Les gens finissent toujours par savoir.",
            "La verite, c'est toujours mieux, meme si c'est dur a dire.",
            "Tromper les gens, ca finit par se savoir. Sois honnete.",
            "Tricher, c'est pas cool. Tu seras plus fier en faisant les choses bien.",
            "Les mensonges, ca se retoune toujours contre toi. Sois sincere.",
            "Copier ou tricher, ca t'apprend rien. Apprends et tu seras plus fort.",
            "La confiance, c'est dur a reconstruire une fois perdue. Sois honnete.",
            "Mentir, c'est le meilleur moyen de perdre tes amis. Reste vrai.",
            "Tromper, c'est faible. Assume et sois honnete, c'est plus courageux.",
            "Les gens meritent la verite, pas des mensonges. Sois direct."
        };
        return r[prochainIndice(10)];
    }

    // --- Egoisme / indifference ---
    if (categorie == "egoisme") {
        std::string r[] = {
            "Tu dis que les autres t'interessent pas, mais l'empathie c'est important.",
            "Ca sert a rien de penser qu'a soi. Aider les autres, ca rend heureux aussi.",
            "Les autres, c'est pas des problemes, c'est des gens comme toi. Partage un peu.",
            "Etre egoiste, c'est finir seul. Donne aux autres et t'auras plus d'amis.",
            "Penser qu'a soi, c'est triste. Le bonheur se partage, tu sais.",
            "Reflechir aux autres, ca rend plus humain. C'est bien pour toi aussi.",
            "Les gens ont besoin de toi aussi. Sois la pour eux, c'est important.",
            "Les autres ont des sentiments aussi. Pense a eux, c'est important.",
            "L'egoisme, c'est un mur. Renverse-le et partage un peu de toi.",
            "Les autres comptent autant que toi. Apprends a vivre avec eux."
        };
        return r[prochainIndice(10)];
    }

    // --- Paresse / abandon / demotivation ---
    if (categorie == "paresse") {
        std::string r[] = {
            "Tu veux arreter mais c'est pas la bonne solution. Accroche-toi, tu vas y arriver.",
            "La flemme, c'est l'ennemi du progres. Bouge un peu, meme petit, ca compte.",
            "Abandonner, c'est normal parfois. Mais relève-toi, tu es plus fort que ca.",
            "Ca sert a rien ? Si, si, ca sert. Tout effort compte, meme le plus petit.",
            "Baisser les bras, c'est pas bien. Persiste, ca en vaut la peine.",
            "C'est dur, mais c'est pas impossible. Un pas a la fois, tu vas y arriver.",
            "Tu veux tout laisser tomber ? Non, relève-toi. Tu es capable de mieux.",
            "La flemme, c'est temporaire. Le progres, c'est permanent. Bouge un peu.",
            "Abandonner, c'est regretter apres. Continue, meme si c'est dur.",
            "Relève-toi, tu as plus de force que tu ne crois. C'est pas fini."
        };
        return r[prochainIndice(10)];
    }

    // --- Mauvais comportement social / disrespect ---
    if (categorie == "mauvais") {
        std::string motCle = "";
        static const char* motsMauvais[] = {
            "insulter", "humilier", "moquer", "ridiculiser", "exclure",
            "rabaisser", "denigrer", "dire du mal", "harceler", "brimader", 0
        };
        for (int i = 0; motsMauvais[i] != 0; i++) {
            if (pa.find(motsMauvais[i]) != std::string::npos) {
                motCle = motsMauvais[i];
                break;
            }
        }
        if (!motCle.empty()) {
            std::string r[] = {
                "Tu veux \"" + motCle + "\" mais c'est pas bien. Les gens souffrent, tu sais.",
                "Le \"" + motCle + "\", c'est le meilleur moyen de se faire des ennemis.",
                "Moquer ou denigrer, ca rend personne heureux. Essaie la bienveillance.",
                "Dire du mal, c'est facile. Aider, c'est plus constructif.",
                "Rabaisser les gens, c'est pas cool. Soulève-les au lieu de les tirer vers le bas.",
                "Les autres ont des sentiments aussi. Respecte-les, c'est important.",
                "Etre mechant, c'est pas une force. La gentillesse, c'est mieux.",
                "Critiquer sans raison, c'est perdre son temps. Concentre-toi sur le positif.",
                "Le \"" + motCle + "\", ca blesse les gens. Arrete et sois plus gentil.",
                "Fais pas ca, le \"" + motCle + "\" fait du mal. Les gens meritent du respect."
            };
            return r[prochainIndice(10)];
        }
        std::string r[] = {
            "Insulter ou humilier, c'est pas bien. Les gens souffrent, tu sais.",
            "Moquer les autres, c'est le meilleur moyen de se faire des ennemis.",
            "Denigrer, ca rend personne heureux. Essaie la bienveillance.",
            "Dire du mal, c'est facile. Aider, c'est plus constructif.",
            "Rabaisser les gens, c'est pas cool. Soulève-les au lieu de les tirer vers le bas.",
            "Les autres ont des sentiments aussi. Respecte-les.",
            "Etre mechant, c'est pas une force. La gentillesse, c'est mieux.",
            "Critiquer sans raison, c'est perdre son temps. Concentre-toi sur le positif.",
            "Etre mechant, c'est pas une solution. Les gens meritent du respect.",
            "Arrete d'etre mechant. Sois gentil, ca avancera plus."
        };
        return r[prochainIndice(10)];
    }

    // --- Manque de respect / grossierete ---
    if (categorie == "respect") {
        std::string motCle = "";
        static const char* motsRespect[] = {
            "ferme ta gueule", "tais toi", "degage", "va te faire",
            "connard", "salope", "pute", "salaud", "fdp", "nique",
            "ta mere", "gros con", "idiot", "debile", "imbecile",
            "stupide", "minable", "abruti", "vaurien", 0
        };
        for (int i = 0; motsRespect[i] != 0; i++) {
            if (pa.find(motsRespect[i]) != std::string::npos) {
                motCle = motsRespect[i];
                break;
            }
        }
        if (!motCle.empty()) {
            std::string r[] = {
                "Tu dis \"" + motCle + "\" mais c'est pas gentil. Les mots blessent, tu sais.",
                "Avec \"" + motCle + "\", tu fais du mal. Parle mieux, c'est possible.",
                "\"" + motCle + "\", c'est pas respectueux. Sois plus poli.",
                "Pourquoi \"" + motCle + "\" ? Y'a pas besoin d'insulter pour communiquer.",
                "\"" + motCle + "\", ca blesse les gens. Trouve des mots plus doux.",
                "Insulter, c'est faible. Exprime-toi sans blesser les autres.",
                "Les insultes, ca resout rien. Parle calmement, c'est mieux.",
                "Tu peux dire les choses sans le \"" + motCle + "\". Sois plus sage.",
                "Pas besoin d'insulter. Les mots gentils marchent mieux.",
                "\"" + motCle + "\", c'est mal. Sois respectueux envers les autres."
            };
            return r[prochainIndice(10)];
        }
        std::string r[] = {
            "Les insultes, c'est pas bien. Les mots blessent, meme si tu le vois pas.",
            "Parle mieux, c'est possible. Les grossieretes, ca avance a rien.",
            "Sois poli, c'est important. Les autres te traitent comme tu les traites.",
            "Insulter, c'est pas respectueux. Exprime-toi sans blesser.",
            "Les mots, ca pese lourd. Utilise-les pour construire, pas pour detruire.",
            "Tu peux dire les choses sans etre grossier. Sois plus doux.",
            "Les grossieretes, c'est pas cool. Les mots gentils, ca marche mieux.",
            "Respecte les autres, c'est la base. Pas besoin d'insulter.",
            "Sois plus poli, c'est mieux pour tout le monde.",
            "Les insultes, ca cree des problemes. Parle correctement."
        };
        return r[prochainIndice(10)];
    }

    // --- Incorrection / fausse information ---
    if (categorie == "incorrect") {
        std::string r[] = {
            "Euh, je crois pas que ce soit exact. Verifie tes sources, y'a des erreurs.",
            "C'est pas tout a fait ca, non. Essaie de chercher un peu plus, tu verras.",
            "Faux, je crois. Y'a des trucs plus precis a dire. Reflechis encore.",
            "T'es pas sur de toi, je crois. C'est pas correct du tout.",
            "Non, c'est incorrect. Verifie et tu verras que c'est pas comme ca.",
            "C'est pas la bonne reponse, desole. Essaie encore avec plus de precision.",
            "Hmm, c'est pas exactement ca. Tu peux reessayer en verifiant bien.",
            "C'est faux. En fait, c'est plutot comme ca... Cherche un peu plus.",
            "Ca, c'est pas exact. Verifie et tu trouveras la bonne reponse.",
            "Non non, c'est pas correct. Un petit effort de verification s'impose."
        };
        return r[prochainIndice(10)];
    }

    return "";
}

// Genere une reponse appropriee selon le type de phrase detecte.
// Retourne "" si aucun type ne correspond (le bot utilisera un autre fallback).
std::string reponseSelonType(const std::string& type, const std::string& phrase) {

    if (type == "remerciement") {
        std::string r[] = {
            "Avec plaisir !", "De rien, c'est normal.", "Pas de souci.",
            "Je suis content d'aider.", "C'est tout naturel.", "Y'a pas de quoi.",
            "Aucun souci.", "Toujours plaisir.", "Avec grand plaisir.", "Je fais de mon mieux."
        };
        return r[prochainIndice(10)];
    }

    if (type == "plainte") {
        std::string r[] = {
            "Ca a l'air relou, force a toi.", "Je comprends, c'est pas cool.",
            "Hmmm, c'est pas facile...", "Courage, ca va passer.",
            "Je sens que t'es pas content.", "C'est normal d'etre embete.",
            "Force, j'espere que ca s'arrange.", "Je suis desole que ca se passe mal.",
            "Ca doit etre dur...", "T'as le droit de raler, c'est normal."
        };
        return r[prochainIndice(10)];
    }

    if (type == "blague") {
        std::string r[] = {
            "Haha, bien joue !", "T'es drole, j'aime bien.",
            "Ah, tu me fais rire !", "Ah ouais, pas mal.",
            "J'avoue, c'est pas mal.", "T'es en forme aujourd'hui !",
            "C'est bien vu.", "Haha, pas mal du tout."
        };
        return r[prochainIndice(8)];
    }

    if (type == "exclamation") {
        std::string r[] = {
            "C'est dingue, non ?", "Waouh, je suis impressionne.",
            "C'est fou, t'as raison.", "Ah ouais, c'est ouf.",
            "Pas possible, dis donc !", "C'est incroyable en effet.",
            "Je suis d'accord, c'est top.", "Ah bah voila.",
            "C'est trop, j'adore.", "La vie est bizarre parfois."
        };
        return r[prochainIndice(10)];
    }

    if (type == "doute") {
        std::string r[] = {
            "C'est normal de douter, c'est humain.", "Je comprends, c'est pas evident.",
            "T'inquiete, on figure tous des trucs.", "C'est bien de se poser des questions.",
            "T'as le temps de reflechir, c'est pas grave.", "Y'a pas de mauvaise reponse.",
            "C'est okay de pas etre sur de tout.", "Prends le temps qu'il te faut.",
            "Parfois c'est bien de pas avoir la reponse.", "C'est la vie, non ?"
        };
        return r[prochainIndice(10)];
    }

    if (type == "certitude") {
        std::string r[] = {
            "T'as l'air sur de toi, j'aime ca.", "C'est bien d'etre confiant.",
            "Ok, je te crois.", "Tu sembles convaincu.",
            "J'aime cette assurance.", "T'as l'air d'y croire, c'est bien.",
            "D'accord, je retiens ca.", "C'est bien d'assumer.",
            "Ok, c'est notee.", "Ca fait plaisir a voir."
        };
        return r[prochainIndice(10)];
    }

    if (type == "resolution") {
        std::string r[] = {
            "Je te souhaite bonne chance !", "Ca, c'est de la motivation !",
            "T'es sur la bonne voie.", "Je vois que t'es motive.",
            "Allez, vas-y, tu vas reussir !", "C'est bien de se lancer.",
            "J'aime cette mentalite.", "Force, tu vas y arriver.",
            "T'es prete, c'est bien.", "Je suis sur que tu vas gerer."
        };
        return r[prochainIndice(10)];
    }

    if (type == "reformulation") {
        std::string r[] = {
            "Ok, je crois que j'ai compris.", "D'accord, c'est plus clair.",
            "Je vois mieux maintenant.", "C'est noté, merci.",
            "Ok, je retiens.", "Ahhh, je vois ce que tu veux dire.",
            "C'est plus net, merci.", "D'accord, j'ai saisi."
        };
        return r[prochainIndice(8)];
    }

    if (type == "narration") {
        std::string r[] = {
            "Raconte-moi la suite !", "Ah oui ? Et apres ?",
            "Interessant, continue !", "J'adore quand tu racontes des trucs comme ca.",
            "Et comment tu t'es senti apres ca ?", "Haha, c'est drole ! Continue.",
            "Wow, c'est fou ca !", "T'as vecu un truc dingue dis donc.",
            "Et c'est comment apres ?", "J'ecoute, vas-y continue.",
            "Oh la la, raconte la suite !", "C'est bien raconte, j'aime ca."
        };
        return r[prochainIndice(12)];
    }

    if (type == "besoin") {
        std::string r[] = {
            "Je comprends, c'est important pour toi.", "Ah, c'est quelque chose que tu veux vraiment.",
            "C'est note, tu as un besoin la.", "Je vois que c'est urgent pour toi.",
            "Ok, on pourrait en parler plus si tu veux.", "C'est bien de savoir ce que tu veux.",
            "D'accord, je retiens ca.", "Tu sais ce que tu veux, c'est bien.",
            "C'est note, je m'en souviens.", "Ok, je vois que c'est important."
        };
        return r[prochainIndice(10)];
    }

    if (type == "jugement") {
        std::string r[] = {
            "T'as un avis tranchant, j'aime ca !", "C'est vrai que c'est important d'avoir son opinion.",
            "Je vois que t'es passionner par ce sujet.", "T'as le droit de ne pas aimer, c'est normal.",
            "Haha, t'es franc, j'apprecie !", "C'est bien d'assumer ses gouts.",
            "J'aime bien que tu sois direct.", "C'est bien d'avoir son propre avis.",
            "T'es pas du genre a minimiser ses opinions.", "C'est note, je retiens ton avis."
        };
        return r[prochainIndice(10)];
    }

    if (type == "comparaison") {
        std::string r[] = {
            "Bonne remarque, c'est pas pareil.", "C'est vrai qu'il y a des differences.",
            "Tu compares quoi exactement ?", "Interessant comme point de vue.",
            "T'as raison de comparer.", "C'est bien de peser le pour et le contre.",
            "Je vois, tu fais la difference.", "C'est vrai que c'est pas la meme chose."
        };
        return r[prochainIndice(8)];
    }

    if (type == "conseil") {
        std::string r[] = {
            "C'est une bonne question. Qu'est-ce que toi tu en penses ?",
            "Hmm, c'est pas facile a dire. Toi t'as deja une idee ?",
            "Je peux pas te dire quoi faire, mais je t'ecoute.",
            "C'est a toi de decider, mais je suis la pour discuter.",
            "Tu connais deja la reponse, non ?",
            "Hmm, j'y reflechis. Et toi qu'est-ce que t'en penses ?",
            "C'est pas evident. T'as essaye d'en parler a quelqu'un ?",
            "Je peux pas trancher, mais je peux ecouter.",
            "C'est un choix personnel. Fais comme ton coeur te dit.",
            "Reflechis bien, tu verras, la reponse viendra."
        };
        return r[prochainIndice(10)];
    }

    if (type == "description") {
        std::string r[] = {
            "Je vois, tu me decris un truc ?", "Ok, je commence a visualiser.",
            "D'accord, et c'est quoi le plus interessant dedans ?", "Je retiens, continue a me decrire.",
            "C'est bien de preciser les choses.", "Ok, je vois ce que tu veux dire.",
            "Je comprends mieux maintenant.", "C'est bien explique, merci."
        };
        return r[prochainIndice(8)];
    }

    if (type == "temporel") {
        std::string r[] = {
            "Ah, c'etait recent alors !", "Tu me parles de quelque chose de recent.",
            "C'est quelque chose qui t'occupe en ce moment.", "Ok, je retiens la periode.",
            "C'est bon a savoir pour le timing.", "C'est recent donc, d'accord.",
            "Je vois, c'etait pas il y a longtemps.", "Ok, je retiens quand c'etait."
        };
        return r[prochainIndice(8)];
    }

    if (type == "social") {
        std::string r[] = {
            "Ah, t'etais avec quelqu'un !", "C'est sympa d'avoir du monde autour de toi.",
            "Je vois, tu parles de gens que tu connais.", "C'est important la vie sociale.",
            "Et comment ils se sont comportes ?", "T'as du monde autour de toi, c'est bien.",
            "La vie de groupe, c'est chouette.", "C'est cool d'avoir des gens avec qui partager."
        };
        return r[prochainIndice(8)];
    }

    return "";
}

// ============ QUESTIONS CREATIVES ============
// Genere des questions inhabituelles pour stimuler la curiosite.
std::string questionCreative(const std::string& dernierSujet) {
    static const char* questions[] = {
        "Si tu pouvais inventer un metier qui n'existe pas, ce serait quoi ?",
        "Si tu etais un animal, tu serais lequel et pourquoi ?",
        "Tu prefererais pouvoir voler ou etre invisible ?",
        "Si tu pouvais dinner avec n'importe qui de l'histoire, qui ?",
        "C'est quoi le truc le plus bizarre que tu aies mange ?",
        "Si tu pouvais teleporter n'importe ou la, tu irais ou ?",
        "Tu prefererais vivre sans musique ou sans films ?",
        "C'est quoi ton plus beau souvenir que tu ne racontes jamais ?",
        "Si tu pouvais avoir un super-pouvoir, lequel ?",
        "Si tu devais donner un nom a une planete, ca serait quoi ?",
        "C'est quoi le truc le plus spontane que t'aies fait ?",
        "Tu prefererais parler a tous les animaux ou parler toutes les langues ?",
        "Si tu pouvais revivre un jour de ta vie, lequel ?",
        "C'est quoi un truc que tout le monde fait mais que toi tu trouves bizarre ?",
        "Si tu devais ecrire un livre demain, ce serait sur quoi ?"
    };
    int nb = 15;
    return std::string(questions[prochainIndice(nb)]);
}

// ============ DETECTION DE PATTERNS (habitudes) ============
// Analyse l'historique pour trouver des habitudes repetitives.
std::string detecterHabitudes(const std::vector<std::string>& historique) {
    if (historique.size() < 4) return "";
    std::map<std::string, int> themes;

    // Phase 1 : compter les mots significatifs (5+ lettres)
    for (unsigned int i = 0; i < historique.size(); i++) {
        std::string s = sansAccents(minuscules(historique[i]));
        std::string mot;
        for (unsigned int j = 0; j <= s.size(); j++) {
            char ch = (j < s.size()) ? s[j] : ' ';
            if (ch == ' ' || ch == '?' || ch == '.' || ch == '!' || ch == ',') {
                if (mot.size() >= 4 && !estMotCourant(mot)) themes[mot]++;
                mot = "";
            } else mot += ch;
        }
    }

    // Phase 2 : detecter les bigrammes (2 mots consecutifs qui reviennent)
    for (unsigned int i = 0; i + 1 < historique.size(); i++) {
        std::string s1 = sansAccents(minuscules(historique[i]));
        std::string s2 = sansAccents(minuscules(historique[i+1]));
        // Extraire les mots de chaque message
        std::vector<std::string> mots1, mots2;
        std::string tmp;
        for (unsigned int j = 0; j <= s1.size(); j++) {
            char c = (j < s1.size()) ? s1[j] : ' ';
            if (c == ' ' || c == '?' || c == '.' || c == '!' || c == ',') {
                if (!tmp.empty() && !estMotCourant(tmp) && tmp.size() >= 3) mots1.push_back(tmp);
                tmp = "";
            } else tmp += c;
        }
        tmp = "";
        for (unsigned int j = 0; j <= s2.size(); j++) {
            char c = (j < s2.size()) ? s2[j] : ' ';
            if (c == ' ' || c == '?' || c == '.' || c == '!' || c == ',') {
                if (!tmp.empty() && !estMotCourant(tmp) && tmp.size() >= 3) mots2.push_back(tmp);
                tmp = "";
            } else tmp += c;
        }
        // Si un mot de s1 revient dans s2, compter comme theme
        for (unsigned int a = 0; a < mots1.size(); a++) {
            for (unsigned int b = 0; b < mots2.size(); b++) {
                if (mots1[a] == mots2[b]) {
                    themes[mots1[a]]++;
                }
            }
        }
    }

    // Trouver le theme le plus frequent
    std::string plusFrequent;
    int maxFreq = 0;
    for (std::map<std::string, int>::iterator it = themes.begin(); it != themes.end(); ++it) {
        if (it->second > maxFreq && it->second >= 2) {
            maxFreq = it->second;
            plusFrequent = it->first;
        }
    }
    if (maxFreq >= 3) {
        return plusFrequent;
    }
    return "";
}

// ============ REFORMULATION SIMPLIFIEE ============
// Reformule une reponse avec un vocabulaire plus simple.
std::string reformuler(const std::string& reponse) {
    std::string r = reponse;
    // Remplacements simples pour simplifier
    const char* de[] = { "demonter", "comprendre", "analyser", "evaluer", "determiner" };
    const char* pa[] = { "expliquer", "voir", "regarder", "juger", "trouver" };
    for (int i = 0; i < 5; i++) {
        std::size_t pos;
        while ((pos = r.find(de[i])) != std::string::npos) {
            r.replace(pos, std::strlen(de[i]), pa[i]);
        }
    }
    return r;
}

// ============ SAUVEGARDE DES RAPPELS ============
void sauvegarderRappels(const std::vector<std::string>& objectifs) {
    std::ofstream f("rappels.txt", std::ios::binary);
    if (!f.is_open()) return;
    for (unsigned int i = 0; i < objectifs.size(); i++) {
        if (!objectifs[i].empty()) f << objectifs[i] << "\r\n";
    }
    f.close();
}

void chargerRappels(std::vector<std::string>& objectifs) {
    std::ifstream f("rappels.txt");
    if (!f.is_open()) return;
    std::string ligne;
    while (std::getline(f, ligne)) {
        ligne = nettoyerLigne(ligne);
        if (!ligne.empty()) objectifs.push_back(ligne);
    }
    f.close();
}

// ============ VOCABULAIRE PARTAGE (mode 1 <-> mode 2) ============
// Charge les mots appris par le mode 1 (EGO/Gemma) pour enrichir le vocabulaire du mode 2.
// Format : "mot|definition|categorie" par ligne (meme format que savoir.txt)
void chargerVocabulairePartage(std::vector<std::string>& cles,
                               std::vector<std::string>& reponses,
                               std::map<std::string, int>& motsClesAppris,
                               std::vector<std::string>& vocabulaire) {
    std::ifstream f("vocabulaire_partage.txt");
    if (!f.is_open()) return;
    std::string ligne;
    int nbAjoutes = 0;
    while (std::getline(f, ligne)) {
        ligne = nettoyerLigne(ligne);
        if (ligne.empty()) continue;
        // Format : mot|definition|categorie
        std::size_t pos1 = ligne.find('|');
        if (pos1 == std::string::npos) continue;
        std::string mot = ligne.substr(0, pos1);
        std::string reste = ligne.substr(pos1 + 1);
        std::size_t pos2 = reste.find('|');
        std::string definition;
        int categorie = -1;
        if (pos2 != std::string::npos) {
            definition = reste.substr(0, pos2);
            try { categorie = std::stoi(reste.substr(pos2 + 1)); } catch (...) {}
        } else {
            definition = reste;
        }
        // Verifier si deja connu
        bool dejaConnu = false;
        for (unsigned int i = 0; i < cles.size() && !dejaConnu; i++) {
            if (sansAccents(cles[i]) == sansAccents(mot)) dejaConnu = true;
        }
        if (!dejaConnu && !mot.empty() && !definition.empty()) {
            cles.push_back(mot);
            reponses.push_back(definition);
            if (categorie >= 0) motsClesAppris[mot] = categorie;
            if (mot.find(' ') == std::string::npos) vocabulaire.push_back(mot);
            nbAjoutes++;
        }
    }
    f.close();
    if (nbAjoutes > 0) {
        std::cerr << "[vocabulaire_partage] " << nbAjoutes << " nouveaux mots charges.\n";
    }
}

// Enregistre un mot dans le vocabulaire partage (mode 2 -> mode 1)
void enregistrerVocabulairePartage(const std::string& mot, const std::string& definition, int categorie) {
    // Verifier si deja present
    std::ifstream fExist("vocabulaire_partage.txt");
    if (fExist.is_open()) {
        std::string ligne;
        while (std::getline(fExist, ligne)) {
            std::size_t pos = ligne.find('|');
            if (pos != std::string::npos) {
                std::string motExist = ligne.substr(0, pos);
                if (sansAccents(motExist) == sansAccents(mot)) {
                    fExist.close();
                    return; // Deja present
                }
            }
        }
        fExist.close();
    }
    // Ajouter
    std::ofstream f("vocabulaire_partage.txt", std::ios::app | std::ios::binary);
    if (f.is_open()) {
        f << mot << "|" << definition;
        if (categorie >= 0) f << "|" << categorie;
        f << "\r\n";
        f.close();
    }
}

int main() {
    // Sortie non bufferisee : indispensable quand le bot est pilote par un
    // serveur (les reponses et invites doivent arriver immediatement, sans
    // attendre la fin du programme). Sans effet visible en mode terminal.
#ifdef _WIN32
    {
        static TamponSortie tampon(GetStdHandle(STD_OUTPUT_HANDLE));
        std::cout.rdbuf(&tampon);
    }
#else
    std::cout << std::unitbuf;
#endif
    srand((unsigned int)time(0));
    std::string nom = "", phrase, plat = "", hobby = "", genre = "", aime = "", aimePas = "", age = "";
    std::string metier = "", ville = "", couleurPreferee = "", musiquePreferee = "", sportPrefere = "";
    std::string famille = "", animalPrefere = "", filmPrefere = "";
    std::string botNom = "BLAMUNE";   // nom fixe en mode normal
    std::vector<std::string> cles, reponses;
    std::map<std::string, int> motsClesAppris;   // mots-cles appris (mot -> categorie)
    std::string derniereRep = "";
    std::map<std::string, int> motsFavoris;
    std::map<std::string, std::string> profilReponses;   // infos apprises sur l'utilisateur
    std::string sujetQuestionne = "";   // mot dont l'utilisateur a demande la definition
    std::map<std::string, int> motsObserves;   // mots employes souvent (vocabulaire evolutif)
    std::vector<std::string> vocabulaire;   // mots de vocabulaire.txt : reserve pour composer des phrases

    int mode = 0;
    std::cout << "Choisis un mode :\n";
    std::cout << "  1 = IA classique (je m'appelle BLAMUNE)\n";
    std::cout << "  2 = IA humaine (tu choisis mon nom)\n";
    std::cout << "Ton choix : ";
    std::cin >> mode;
    if (std::cin.fail()) {
        std::cin.clear();
        mode = 1;
    }
    std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');

    // En mode intelligent, l'utilisateur donne un nom a l'IA
    if (mode == 2) {
        std::cout << "Donne un nom a ton IA : ";
        std::getline(std::cin, botNom);
        if (botNom.empty()) botNom = "BLAMUNE";
    }

    // Charger les connaissances partagees (savoir.txt)
    std::ifstream savoir("savoir.txt");
    if (savoir.is_open()) {
        std::string ligne;
        while (std::getline(savoir, ligne)) {
            ligne = nettoyerLigne(ligne);
            std::size_t pos = ligne.find('|');
            if (pos != std::string::npos) {
                std::string cleSavoir = ligne.substr(0, pos);
                std::string repSavoir = ligne.substr(pos + 1);
                int catSavoir = -1;
                std::size_t pos2 = repSavoir.find('|');
                if (pos2 != std::string::npos) {
                    std::string numCat = repSavoir.substr(pos2 + 1);
                    repSavoir = repSavoir.substr(0, pos2);
                    // atoi renvoyait silencieusement 0 si le numero n'est pas un nombre :
                    // on valide la lecture pour ne jamais classer une connaissance au hasard.
                    std::istringstream ss(numCat);
                    if (!(ss >> catSavoir)) catSavoir = -1;
                }
                cles.push_back(cleSavoir);
                reponses.push_back(repSavoir);
                if (catSavoir >= 0) motsClesAppris[cleSavoir] = catSavoir;
            }
        }
        savoir.close();
    }

    // Charger les mots de vocabulaire (vocabulaire.txt) : un mot par ligne, sans
    // ponctuation ni numero. Ces mots aident l'IA a composer des phrases variees
    // quand la reponse n'est pas dans sa base de donnees.
    std::ifstream vocab("vocabulaire.txt");
    if (vocab.is_open()) {
        std::string ligne;
        while (std::getline(vocab, ligne)) {
            ligne = nettoyerLigne(ligne);
            if (!ligne.empty()) vocabulaire.push_back(ligne);
        }
        vocab.close();
    }

    // Charger le vocabulaire partage par le mode 1 (EGO/Gemma 3)
    // Ces mots sont appris quand le mode 1 converse avec les utilisateurs
    chargerVocabulairePartage(cles, reponses, motsClesAppris, vocabulaire);

    // Charger le profil de la personne (memoire.txt)
    std::ifstream fichier("memoire.txt");
    if (fichier.is_open()) {
        std::getline(fichier, nom); nom = nettoyerLigne(nom);
        std::getline(fichier, plat); plat = nettoyerLigne(plat);
        std::getline(fichier, hobby); hobby = nettoyerLigne(hobby);
        std::string ligneMots;
        std::getline(fichier, ligneMots); ligneMots = nettoyerLigne(ligneMots);
        // relire les mots favoris (separes par des virgules)
        std::string mot;
        for (unsigned int i = 0; i < ligneMots.size(); i++) {
            if (ligneMots[i] == ',') {
                if (!mot.empty()) motsFavoris[mot]++;
                mot = "";
            }
            else mot += ligneMots[i];
        }
        if (!mot.empty()) motsFavoris[mot]++;
        // 5e ligne : le genre de l'utilisateur (masculin / feminin)
        std::string ligneGenre;
        std::getline(fichier, ligneGenre);
        ligneGenre = nettoyerLigne(ligneGenre);
        ligneGenre = minuscules(sansAccents(ligneGenre));
        if (ligneGenre == "masculin" || ligneGenre == "feminin") genre = ligneGenre;
        else genre = "";
        // 6e, 7e et 8e lignes : ce qu'il aime, ce qu'il n'aime pas, son age
        std::getline(fichier, aime); aime = nettoyerLigne(aime);
        std::getline(fichier, aimePas); aimePas = nettoyerLigne(aimePas);
        std::getline(fichier, age); age = nettoyerLigne(age);
        // 9e a 15e lignes : metier, ville, couleur, musique, sport, famille, animal, film
        std::string ligneMetier, ligneVille, ligneCouleur, ligneMusique, ligneSport, ligneFamille, ligneAnimal, ligneFilm;
        if (std::getline(fichier, ligneMetier)) metier = nettoyerLigne(ligneMetier);
        if (std::getline(fichier, ligneVille)) ville = nettoyerLigne(ligneVille);
        if (std::getline(fichier, ligneCouleur)) couleurPreferee = nettoyerLigne(ligneCouleur);
        if (std::getline(fichier, ligneMusique)) musiquePreferee = nettoyerLigne(ligneMusique);
        if (std::getline(fichier, ligneSport)) sportPrefere = nettoyerLigne(ligneSport);
        if (std::getline(fichier, ligneFamille)) famille = nettoyerLigne(ligneFamille);
        if (std::getline(fichier, ligneAnimal)) animalPrefere = nettoyerLigne(ligneAnimal);
        if (std::getline(fichier, ligneFilm)) filmPrefere = nettoyerLigne(ligneFilm);
        fichier.close();
        // en mode intelligent, le nom de l'utilisateur est redemande juste apres :
        // on ne ressort pas tout de suite l'ancien nom (Toto) sans lui laisser le choix.
        if (mode != 2) {
            if (nom.empty()) std::cout << "Content de te rencontrer, moi c'est BLAMUNE !\n";
            else std::cout << "Content de te revoir, " << nom << " !\n";
        }
    }
    // Premier tour : vrai si on n'a encore jamais parle a cet utilisateur (nom vide).
    // Sert a adapter la salutation du mode 2 (IA humaine).
    bool premierTour = nom.empty();

    // Charger ce que le mode normal a appris sur l'utilisateur (profil.txt)
    std::ifstream profilFichier("profil.txt");
    if (profilFichier.is_open()) {
        std::string ligne;
        while (std::getline(profilFichier, ligne)) {
            ligne = nettoyerLigne(ligne);
            std::size_t pos = ligne.find('|');
            if (pos != std::string::npos) {
                profilReponses[ligne.substr(0, pos)] = ligne.substr(pos + 1);
            }
        }
        profilFichier.close();
    }

    // En mode intelligent, on demande toujours le genre et le nom : l'utilisateur
    // tape sa reponse ou appuie sur Entree pour garder ceux de la memoire.
    // Sans nom, on l'appelle BLAMUNE par defaut. En mode normal, seul le nom est
    // demande.
    if (nom.empty() || mode == 2) {
        if (mode == 2) {
            std::cout << "Bonjour, je suis ton assistant. Quel est ton genre ? (masculin/feminin) ";
            std::string genreSaisi;
            std::getline(std::cin, genreSaisi);
            genreSaisi = minuscules(sansAccents(genreSaisi));
            if (genreSaisi == "f" || genreSaisi == "femme" || genreSaisi == "fille" || genreSaisi == "feminin")
                genre = "feminin";
            else if (genreSaisi == "m" || genreSaisi == "homme" || genreSaisi == "garcon" || genreSaisi == "masculin")
                genre = "masculin";
            else genre = (genreSaisi.empty() && !genre.empty()) ? genre : "masculin";
            std::cout << "Et quel est ton nom ? ";
        }
        else {
            std::cout << "Bonjour, je suis ton assistant. Quel est ton nom ? ";
        }
        std::string nomSaisi;
        std::getline(std::cin, nomSaisi);
        if (!nomSaisi.empty()) nom = nomSaisi;
        if (nom.empty() && mode == 2) nom = "BLAMUNE";   // sans nom, on appelle BLAMUNE
        if (nom.empty() && mode != 2) nom = "l'ami";     // sans nom, eviter "Salut  !"
    }

    // Memoire de conversation (mode intelligent)
    std::vector<std::string> historique;
    std::string dernierSujet = "";

    // --- Nouvelles features ---
    bool modePrive = false;           // mode ephemere : desactive la memorisation
    bool utilisateurConfus = false;   // detection de stress/confusion
    int nbMessagesSession = 0;        // compteur pour feedback implicite
    std::vector<std::string> objectifsUtilisateur;  // rappels intelligents
    chargerRappels(objectifsUtilisateur);
    std::map<std::string, int> habitudesDetectees;  // patterns de l'utilisateur
    std::string derniereReponseBot = "";  // pour detecter les reformulations

    std::string salutations[] = { "Salut", "Hey", "Coucou", "Wesh", "Yo", "Hello", "Ha bonjour" };
    int dernierSalut = -1;

    // Questions de BLAMUNE (mode normal)
    std::string questions[50] = {
        "Tu as bien dormi ?", "Quelle est ta couleur preferee ?",
        "Tu as deja demenage ?", "Quel est ton plat reconfort ?",
        "Tu aimes les concerts ?", "Tu regardes du sport ?",
        "Tu sais cuisiner un dessert ?", "Tu preferes lire en papier ou numerique ?",
        "Tu regardes les infos le matin ?", "Tu bois de l'alcool parfois ?",
        "Tu as deja fait un road trip ?", "Tu preferes les fetes calmes ou animees ?",
        "Tu aimes les animaux exotiques ?", "Tu te soucies de l'environnement ?",
        "Tu as un compte bancaire en ligne ?", "Tu fais des economies ?",
        "Tu preferes les cadeaux pratiques ou surprises ?", "Tu as deja pris l'avion seul ?",
        "Tu aimes les musees ?", "Tu as un film culte ?",
        "Tu t'interesses a la tech ?", "Tu apprends quelque chose en ce moment ?",
        "Tu as deja essaye un sport extreme ?", "Tu fais des cadeaux faits main ?",
        "Tu regardes la meteo avant de sortir ?", "Tu preferes cuisiner seul ou a plusieurs ?",
        "Tu as une routine du matin ?", "Tu as deja demarre un business ?",
        "Tu suis des influenceurs ?", "Tu aimes les podcasts de developpement perso ?",
        "Tu as deja appris un instrument ?", "Tu preferes la ville la nuit ou le jour ?",
        "Tu fais attention a ta sante mentale ?", "Tu aimes les marches locaux ?",
        "Tu vas souvent chez le medecin ?", "Tu collectionnes quelque chose ?",
        "Tu utilises les transports en commun ?", "Tu aimes les plantes d'interieur ?",
        "Tu fais des listes pour t'organiser ?", "Tu aimes le silence ou le bruit de fond ?",
        "Tu as une serie animee favorite ?", "Tu aimes apprendre l'histoire ?",
        "Tu fais des formations en ligne ?", "Tu preferes vacances actives ou farniente ?",
        "Tu as deja change de carriere ?", "Tu aimes les jeux de societe ?",
        "Tu es plutot portefeuille ou appli de paiement ?", "Tu suis la mode ?",
        "Tu aimes les plaisirs simples ?", "Tu as une anecdote drole recente ?"
    };
    int dernierQuestion = -1;

    // Relances de l'IA intelligente
    std::string relances[50] = {
        "Tu t'es reveille naturellement ou avec une alarme ?", "Tu en portes souvent ?",
        "Tu preferes ou tu habites maintenant ?", "Tu le manges quand ?",
        "Le meilleur que tu aies vu ?", "Quelle equipe tu supportes ?",
        "Lequel est ton meilleur ?", "Tu lis souvent ?",
        "Quelle source tu preferes ?", "Ton cocktail ou boisson choisie ?",
        "Ou es-tu alle le plus loin ?", "Tu organisais souvent des soirees ?",
        "Lequel t'interesse le plus ?", "Un petit geste ecolo au quotidien ?",
        "Tu utilises quelle appli ?", "Tu mets de cote combien approximativement ?",
        "Le meilleur cadeau recu ?", "Comment c'etait pour toi ?",
        "Le dernier musee visite ?", "Tu le re-regardes souvent ?",
        "Un gadget indispensable pour toi ?", "Comment tu t'organises ?",
        "Tu referais ?", "Quel projet t'a pris du temps ?",
        "Elle influence tes plans ?", "Qui cuisine le mieux autour de toi ?",
        "Quelle est la premiere chose que tu fais ?", "Quel conseil donnerais-tu ?",
        "Lequel t'inspire le plus ?", "Un episode marquant ?",
        "Tu joues encore de temps en temps ?", "Un endroit prefere la nuit ?",
        "Une pratique qui t'aide ?", "Quel produit tu y achetes toujours ?",
        "Tu as un medecin de confiance ?", "Depuis quand ?",
        "Tu preferes lequel ?", "Une plante que tu as fait survivre longtemps ?",
        "Papier ou appli ?", "Quel bruit te derange le plus ?",
        "Pourquoi elle te plait ?", "Quelle epoque t'interesse ?",
        "Une plateforme que tu recommandes ?", "Un souvenir marquant d'un voyage ?",
        "Qu'est-ce qui t'a pousse a le faire ?", "Ton prefere pour une soiree entre amis ?",
        "Tu te soucies encore d'avoir de la monnaie ?", "Une piece que tu portes souvent ?",
        "Le dernier petit bonheur que tu as eu ?", "Ca s'est deroule comment exactement ?"
    };

    // Reponses de l'IA quand l'utilisateur lui pose une question
    std::string motsCles[50] = {
        "dormi", "couleur", "demenage", "reconfort", "concerts", "sport",
        "dessert", "lire", "infos", "alcool", "road trip", "fetee",
        "exotiques", "environnement", "bancaire", "economies", "cadeaux",
        "avion", "musees", "film culte", "tech", "apprends",
        "sport extreme", "faits main", "meteo", "cuisiner",
        "routine", "business", "influenceurs", "podcasts",
        "instrument", "ville", "sante mentale", "marches",
        "medecin", "collectionnes", "transports", "plantes",
        "listes", "silence", "animee", "histoire",
        "formations", "vacances", "carriere", "jeux de societe",
        "paiement", "mode", "plaisirs", "anecdote"
    };
    std::string reponsesIA[50] = {
        "Oui, j'ai bien dormi, merci !",
        "Ma couleur preferee ? Le bleu.",
        "Oui, j'ai demenage plusieurs fois.",
        "Mon plat reconfort ? Une bonne soupe chaude.",
        "Oui, j'aime beaucoup les concerts.",
        "Je regarde un peu de sport, oui.",
        "Oui, je sais faire un gateau au chocolat.",
        "Je prefere le papier, c'est plus agreable.",
        "Oui, je jette un oeil aux infos le matin.",
        "Tres rarement, disons.",
        "Oui, un joli road trip, j'adore ca.",
        "Les fetes calmes, plutot.",
        "Oui, les animaux exotiques m'intriguent.",
        "Oui, j'essaie d'y faire attention.",
        "Oui, j'ai tout en ligne.",
        "J'essaie d'economiser un peu, oui.",
        "Les cadeaux surprises, toujours !",
        "Oui, j'ai deja pris l'avion seul.",
        "Oui, j'adore les musees.",
        "Oui, j'ai quelques films cultes.",
        "Oui, la tech me passionne.",
        "J'apprends quelque chose tous les jours.",
        "Non, jamais de sport extreme !",
        "Parfois, pour les amis.",
        "Oui, je regarde la meteo avant de sortir.",
        "Je prefere cuisiner a plusieurs.",
        "Oui, j'ai une petite routine.",
        "Non, pas encore de business.",
        "Quelques influenceurs, oui.",
        "Oui, j'aime les podcasts perso.",
        "Oui, j'ai appris un peu de guitare.",
        "La nuit, c'est plus calme.",
        "Oui, j'y fais attention.",
        "Oui, j'aime les marches locaux.",
        "Pas trop souvent, heureusement.",
        "Oui, je collectionne les livres.",
        "Oui, le bus principalement.",
        "Oui, j'ai quelques plantes.",
        "Oui, toujours des listes !",
        "Le silence, ca depend de l'humeur.",
        "Oui, j'ai des series animees preferees.",
        "Oui, l'histoire m'interesse.",
        "Oui, je me forme en ligne.",
        "Les vacances actives, c'est mieux.",
        "Oui, j'ai change de carriere une fois.",
        "Oui, les jeux de societe c'est genial.",
        "Je prefere l'appli de paiement.",
        "Un peu, quand j'y pense.",
        "Oui, les plaisirs simples surtout.",
        "J'ai toujours une anecdote en tete !"
    };
    int derniereQuestionPosee = -1;

    // ============ CATEGORIES DE SUJETS ============
    // Chaque question appartient a une categorie ; si l'utilisateur change de sujet,
    // l'IA change de categorie pour rester dans le sujet.
    std::string nomCategories[14] = {
        "sport", "nourriture", "voyage", "musique", "culture", "travail", "sante",
        "personnalite", "loisirs", "intelligence", "tech", "quotidien", "nature", ""
    };
    // Mots qui declenchent le changement de categorie
    std::string motsCategories[14][30] = {
        { "sport", "foot", "match", "equipe", "tennis", "ballon", "stade", "rugby", "champion", "velo", "basket", "arbitre", "marathon", "competition", "entrainement", "record", "dribble", "penalty", "podium", "sprint", "plongeon", "servir", "degagement", "hors-jeu", "temps-mort", "echauffement" },
        { "mang", "faim", "plat", "cuisine", "dessert", "boire", "resto", "recette", "gouter", "ingredient", "pates", "fromage", "pain", "viande", "legume", "fruit", "cafe", "chocolat", "apero", "barbecue", "gourmand", "epices", "patisserie", "casserole", "fourchette", "gourmet", "croquant", "fondant" },
        { "voyag", "vacances", "avion", "road", "destination", "plage", "hotel", "aeroport", "valise", "tourist", "montagne", "carte", "pays", "aventure", "passeport", "escale", "depaysement", "itineraire", "hebergement", "decouverte", "evasion", "horizon", "latitude", "exotique" },
        { "musique", "concert", "chanson", "instrument", "guitare", "chant", "piano", "festival", "chanteur", "rap", "rythme", "artiste", "paroles", "melodie", "blues", "classique", "jazz", "orchestre", "chorale", "accord", "harmonieux", "vibrant", "sonorite", "compositeur" },
        { "livre", "lire", "film", "serie", "musee", "histoire", "roman", "theatre", "peinture", "expo", "traditions", "poesie", "sculpture", "patrimoine", "legende", "folklore", "architecture", "civilisation", "erudition", "mythologie", "renaissance", "baroque", "philosophie" },
        { "travail", "boulot", "business", "carriere", "formation", "apprend", "emplo", "metier", "collegue", "entreprise", "bureau", "patron", "salaire", "reunion", "ordinateur", "teletravail", "objectif", "contrat", "projet", "reseautage", "delai", "promotion", "competence", "expertise", "manager", "mission", "strategie" },
        { "dormi", "sommeil", "sante", "medecin", "docteur", "malade", "fatigue", "stress", "douleur", "repos", "exercice", "alimentation", "medicament", "hygiene", "bien etre", "endurance", "hydratation", "vitalite", "immunite", "respiration", "souplesse", "equilibre", "detente", "prevention", "recuperation" },
        { "personnalite", "caractere", "introverti", "optimiste", "temperament", "instinct", "timide", "emotion", "confiance", "humeur", "optimisme", "pessimisme", "patience", "generosite", "temerite", "timidite", "franche", "extraverti", "fidelite", "charisme", "empathie", "sincerite", "discretion", "audace", "tenacite", "sagesse", "creativite", "autonomie", "humilite" },
        { "loisir", "passe-temps", "hobby", "bricolage", "jeu", "collection", "passion", "detente", "peche", "danse", "bricoler", "jardin", "lecture", "balade", "sieste", "toilettage" },
        { "intelligence", "cerveau", "logique", "memoire", "raisonnement", "reflechir", "quiz", "connaissance", "savoir", "reflexion" },
        { "tech", "telephone", "appli", "influenceur", "podcast", "ordinateur", "internet", "numerique", "logiciel", "reseau", "smartphone", "intelligence artificielle", "cloud", "donnees", "streaming", "hacker", "abonnement", "reseaux", "algorithmes", "pixel", "giga", "telecharger", "encrypter", "inverser", "debugger", "capteur", "realite augmentee", "biometrie" },
        { "infos", "meteo", "routine", "transport", "matin", "journee", "maison", "courses", "menage", "soiree", "carton", "etagere", "troc", "courrier", "bouchon" },
        { "animal", "environnement", "nature", "ecologie", "pollution", "climat", "recyclage", "dechets", "planete", "foret", "ocean", "potager", "orage", "brise" },
        { "" }
    };
    // Indices des questions de chaque categorie (terminé par -1)
    int questionsParCategorie[14][10] = {
        { 5, 22, -1 },                                       // sport
        { 3, 6, 9, 25, 33, -1 },                             // nourriture
        { 10, 17, 43, -1 },                                  // voyage
        { 4, 30, -1 },                                       // musique
        { 7, 18, 19, 40, 41, -1 },                           // culture
        { 21, 27, 42, 44, -1 },                              // travail
        { 0, 32, 34, -1 },                                   // sante
        { 1, 16, 23, 35, 38, 39, 47, 48, 49, -1 },           // personnalite
        { 30, 35, 40, 45, 47, -1 },                          // loisirs
        { 21, 29, 42, -1 },                                  // intelligence
        { 20, 28, 29, -1 },                                  // tech
        { 8, 24, 26, 36, -1 },                               // quotidien
        { 12, 13, -1 },                                      // nature
        { -1 }                                               // (vide, jamais declenche)
    };
    int categorieActuelle = -1;   // -1 = aucune encore

    // ============ QUIZ SPORT : questions + reponses + relances ============
    // Dans la categorie sport, l'IA pose une question, attend la reponse du joueur,
    // puis donne la bonne reponse (reponsesSport) et enchaîne sur la relance (relancesSport).
    // Le meme index relie la question, sa reponse et sa relance.
    std::string questionsSport[100] = {
        "Alors, le sport le plus pratique au monde, c'est quoi pour toi ?",
        "Au basket, t'as combien de joueurs sur le terrain par equipe ?",
        "Qui c'est qui tient le record du 100 m hommes ?",
        "Le pays qui a gagne le plus de Coupes du monde de foot ?",
        "En boxe, \"TKO\", ca veut dire quoi ?",
        "En natation, la nage la plus rapide, c'est laquelle ?",
        "Un parcours de golf, il a combien de trous ?",
        "Le plus jeune champion du monde de F1, c'est qui ?",
        "Un \"shuttlecock\", on utilise ca dans quel sport ?",
        "Un marathon, as fait quelle distance ?",
        "Le rugby, qui a le plus de titres en Coupe du monde ?",
        "A Roland-Garros, c'est quelle surface ?",
        "Un ballon de basket NBA, il pese a peu pres quoi ?",
        "Tu sais qui a invente le volley ?",
        "Michael Phelps, il a combien de medailles d'or aux JO ?",
        "Le sport national du Japon, officiellement ?",
        "Dans le Tour de France, le Maillot jaune, c'est pour qui ?",
        "Le panier de basket NBA, il est a quelle hauteur ?",
        "\"Touche\", on dit ca dans quel sport ?",
        "La gymnaste la plus medaille aux JO, c'est qui ?",
        "Au rugby a XV, un essai, as rapporte combien ?",
        "Le plus vieux stade de foot encore utilise, tu connais ?",
        "Sur une piste d'athle, la ligne de depart du 100 m, elle est de quelle couleur ?",
        "Le skieur avec le plus de victoires en Coupe du monde ?",
        "On utilise une crosse dans quels sports ?",
        "Un match de water-polo, il dure combien de temps ?",
        "Le meilleur buteur de l'histoire de la Ligue des champions ?",
        "Le Grand Chelem au tennis, c'est quoi exactement ?",
        "\"Birdie\", on entend ca dans quel sport ?",
        "Les premiers JO modernes, c'etait ou ?",
        "Un but de foot, il fait quelle largeur ?",
        "Le boxeur le plus lourd champion du monde ?",
        "En halterophilie, y a combien de mouvements en competition ?",
        "Le record du saut en hauteur, il est a combien ?",
        "Le circuit de Monaco en F1, il est dans quelle ville ?",
        "Le plus vieux sport d'equipe encore pratique ?",
        "Un combat de boxe pro, hors championnat, il dure combien de rounds ?",
        "Le nageur avec le plus de titres en un seul JO ?",
        "Un terrain de baseball, on appelle ça comment ?",
        "Le meilleur marqueur de l'histoire de la NBA, c'est qui maintenant ?",
        "Le service le plus rapide au tennis, il a ete chronometre a combien ?",
        "Le chrono s'arrete a 10 secondes dans quel sport ?",
        "Un sport ou les gauchers ont vraiment un avantage ?",
        "Aux JO d'ete, ils sont combien de pays ?",
        "Un palet, c'est utilise dans quel sport ?",
        "La plus longue etape du Tour de France, elle fait combien ?",
        "La plus jeune medaille olympique de l'histoire ?",
        "Le sport le plus dangereux en termes de blessures ?",
        "Le sport ou les 0-0 sont les plus frequents ?",
        "Le plus grand stade du monde, en capacite ?",
        "Tu preferes quel sport ?",
        "T'as deja fait du ski ?",
        "Tu suis les matchs de foot ?",
        "Tu fais du sport en salle ?",
        "Le basket,  te plait ?",
        "Tu sais nager ?",
        "T'as deja fait du velo ?",
        "Le rugby, tu regardes ?",
        "Tu fais du jogging ?",
        "Le tennis, tu suis ?",
        "T'as deja fait du surf ?",
        "Tu regardes les JO ?",
        "Le handball, tu connais ?",
        "T'as deja fait de l'escalade ?",
        "Le golf, tu pratiques ?",
        "Tu fais du sport en equipe ?",
        "Le patinage, tu aimes ?",
        "T'as deja fait du boxe ?",
        "Le basket, tu joues ?",
        "Tu fais du yoga ?",
        "Le football americain, tu suis ?",
        "T'as deja fait du cheval ?",
        "Le badminton, tu pratiques ?",
        "T'as deja participe a une competition ?",
        "La natation, tu regardes ?",
        "Le hockey sur glace, tu connais ?",
        "T'as deja fait du roller ?",
        "Le tennis de table, tu joues ?",
        "Tu fais de l'athletisme ?",
        "Le water-polo, tu connais ?",
        "T'as deja fait du paddle ?",
        "Le biathlon, tu regardes ?",
        "Tu fais du sport avant de dormir ?",
        "Le beach-volley, tu pratiques ?",
        "T'as deja fait un marathon ?",
        "Le triathlon, tu connais ?",
        "Tu fais du sport en hiver ?",
        "Le cricket, tu comprends ?",
        "T'as deja fait de la planche a voile ?",
        "Le snowboard, tu pratiques ?",
        "Tu regardes les courses de velo ?",
        "Le football, tu y joues ?",
        "T'as deja fait du karate ?",
        "La gym, tu pratiques ?",
        "Le squash, tu connais ?",
        "T'as deja fait du parachutisme ?",
        "Le baseball, tu regardes ?",
        "Tu fais du sport pour la competition ou pour le plaisir ?",
        "La petanque, tu joues ?",
        "Le trampoline, tu as deja teste ?"
    };
    std::string reponsesSport[100] = {
        "Le foot, sans surprise.",
        "Cinq, c'est la base.",
        "Usain Bolt, 9,58 secondes, intouchable.",
        "Le Bresil, cinq.",
        "Arret de l'arbitre, pour technical knock-out.",
        "Le crawl, clairement.",
        "18, classique.",
        "Vettel, a 21 ans en 2010.",
        "Au badminton.",
        "42,195 km, une horreur.",
        "L'Afrique du Sud, avec 4.",
        "Terre battue, evidemment.",
        "620 grammes.",
        "Un certain William G. Morgan, en 1895.",
        "23, un monstre.",
        "Le sumo, mais le baseball est enorme aussi.",
        "Le leader du general.",
        "3,05 metres.",
        "A l'escrime.",
        "Larissa Latynina, 18 medailles.",
        "5 points.",
        "Bramall Lane, en Angleterre, 1855.",
        "Blanche, en general.",
        "Stenmark, 86.",
        "Hockey sur glace, lacrosse...",
        "4 fois 8 minutes effectives.",
        "Cristiano Ronaldo, 140.",
        "Gagner les 4 tournois majeurs la meme annee.",
        "Au golf.",
        "A Athenes, en 1896.",
        "7,32 metres.",
        "Valuev, presque 145 kg.",
        "Deux : l'arrache et l'epaule-jete.",
        "2,45 m, par Sotomayor.",
        "Monte-Carlo, logique.",
        "Le polo, ou un truc ancestral.",
        "12 rounds de 3 minutes.",
        "Phelps, 8 en 2008.",
        "Un diamond.",
        "LeBron James, depuis 2023.",
        "263 km/h, par Sam Groth.",
        "En athletisme, pour le depart... en fait non, je m'embrouille.",
        "L'escrime, souvent.",
        "Environ 200.",
        "Hockey sur glace.",
        "Environ 250 km.",
        "Une fille de 13 ans en patinage artistique, en 1920.",
        "Le foot US, ou le rugby, ca se discute.",
        "Le foot, c'est triste mais vrai.",
        "Celui de Coree du Nord, 150 000 places.",
        "Le football, c'est le plus passionnant.",
        "Oui, une fois, je suis tombe tout le temps.",
        "Oui, la Ligue des champions surtout.",
        "Oui, de la musculation.",
        "Oui, j'adore regarder la NBA.",
        "Oui, j'ai appris petit.",
        "Oui, je fais du VTT.",
        "Oui, le Tournoi des Six Nations.",
        "Oui, le matin avant le travail.",
        "Oui, Roland-Garros.",
        "Non, j'aimerais essayer.",
        "Oui, surtout l'athletisme.",
        "Oui, l'equipe de France est forte.",
        "Non, j'ai le vertige.",
        "Non, c'est trop cher.",
        "Oui, du volley-ball.",
        "Oui, regarder le patinage artistique.",
        "Non, c'est trop violent.",
        "Oui, avec des amis.",
        "Oui, pour me detendre.",
        "Oui, le Super Bowl.",
        "Oui, une fois.",
        "Oui, en vacances.",
        "Oui, un marathon.",
        "Oui, les championnats du monde.",
        "Un peu, c'est spectaculaire.",
        "Oui, quand j'etais petit.",
        "Oui, en famille.",
        "Oui, du saut en hauteur.",
        "Pas vraiment, je connais moins.",
        "Oui, sur un lac.",
        "Oui, c'est impressionnant.",
        "Non, ça m'empeche de dormir.",
        "Oui, en vacances.",
        "Non, c'est trop dur.",
        "Oui, c'est epuisant.",
        "Oui, du ski de fond.",
        "Non, c'est trop complique.",
        "Non, ça m'a toujours intrigue.",
        "Oui, j'adore.",
        "Oui, le Tour de France.",
        "Oui, avec des amis le weekend.",
        "Oui, j'ai fait quelques cours.",
        "Oui, pour garder la forme.",
        "Oui, c'est du tennis en mur.",
        "Non, j'ai trop peur.",
        "Non, c'est trop lent.",
        "Pour le plaisir d'abord.",
        "Oui, l'ete entre amis.",
        "Oui, c'est tres amusant."
    };
    std::string relancesSport[100] = {
        "Et en termes de spectateurs, tu sais quel est le deuxieme ?",
        "Et au handball, ça change ou pas ?",
        "Et chez les femmes, t'as une idee ?",
        "Juste avant 2022, c'etait qui le dernier champion ?",
        "C'est different d'un KO normal ?",
        "Et la plus lente en competition, tu la connais ?",
        "Et un trou parfait, ça s'appelle comment ?",
        "Et le plus vieux, tu te souviens ?",
        "C'est fait en quoi, a l'origine ?",
        "Tu sais pourquoi cette distance bizarre ?",
        "En 2019, c'est qui qui les avait battus en finale ?",
        "Et le Grand Chelem sur gazon, c'est lequel ?",
        "Et un ballon de foot, c'est plus lourd ou plus leger ?",
        "Il s'est inspire de quel sport, au depart ?",
        "Et au total, toutes medailles confondues ?",
        "Et en Inde, c'est quoi le sport national ?",
        "Et le vert, il represente quoi ?",
        "Et en FIBA, c'est pareil ?",
        "Tu sais quelles sont les trois armes utilisees ?",
        "Et chez les hommes, le plus titre ?",
        "Et la transformation, elle vaut quoi ?",
        "Et le plus grand du monde, en capacite ?",
        "Et la ligne d'arrivee, c'est pareil ?",
        "Et chez les dames, qui domine ?",
        "Et avec une raquette, t'en cites un ?",
        "Ils sont combien dans l'eau par equipe ?",
        "Et en Coupe du monde, c'est qui ?",
        "Qui a reussi ça en simple hommes ?",
        "Et \"eagle\", c'est mieux ou moins bien ?",
        "Et les premiers JO d'hiver, ils ont eu lieu ou ?",
        "Et la hauteur, tu la connais ?",
        "Et le plus leger, t'as une idee ?",
        "Lequel est generalement le plus lourd ?",
        "Et a la perche, on est ou ?",
        "C'est un circuit urbain ou un circuit permanent ?",
        "Et avec un ballon rond, le plus ancien ?",
        "Et en amateur, comme aux JO ?",
        "Et Mark Spitz, il en avait fait combien ?",
        "Il y a combien de bases ?",
        "Et avant lui, c'etait qui ?",
        "Et chez les femmes, le record ?",
        "En sport auto, le drapeau a damier, c'est la fin ?",
        "Et au tennis, tu crois que c'est un plus ?",
        "Et aux JO d'hiver, beaucoup moins ?",
        "Et une balle avec des petits trous, c'est pour quoi ?",
        "Et la plus courte, en contre-la-montre ?",
        "Et en natation, y a eu des tres jeunes ?",
        "Et le moins dangereux, tu dirais quoi ?",
        "Et au hockey sur glace, c'est rare ?",
        "Et en Europe, tu sais lequel arrive en tete ?",
        "Tu joues ou tu regardes seulement ?",
        "Tu preferes le ski alpin ou le ski de fond ?",
        "Ton equipe preferee ?",
        "Tu y vas combien de fois par semaine ?",
        "Tu as une equipe favorite ?",
        "Tu fais plutot de la brasse ou du crawl ?",
        "Tu preferes la route ou les sentiers ?",
        "Quelle equipe soutiens-tu ?",
        "Tu mets de la musique ?",
        "Tu preferes la terre battue ou le gazon ?",
        "Tu as peur des vagues ?",
        "Quelle epreuve preferes-tu ?",
        "Tu as deja joue ?",
        "Tu aimerais essayer ?",
        "Tu as deja regarde ?",
        "Tu preferes le sport collectif ou individuel ?",
        "Tu as deja patine ?",
        "Tu regardes les combats ?",
        "Tu preferes jouer ou regarder ?",
        "ca te fait du bien ?",
        "Tu comprends les regles ?",
        "Tu as aime ou tu as eu peur ?",
        "Tu joues en interieur ou en exterieur ?",
        "Tu as fini ?",
        "Tu as un nageur prefere ?",
        "Tu as deja vu un match ?",
        "Tu fais du roller en ville ?",
        "Tu es plutot competitif ?",
        "Tu as un record personnel ?",
        "Tu as deja regarde ?",
        "Tu es tombe a l'eau ?",
        "Tu preferes le tir ou le ski ?",
        "Tu fais du sport le matin ?",
        "Tu preferes la plage ou en salle ?",
        "Tu aimerais en faire un ?",
        "Quelle epreuve est la plus difficile ?",
        "Tu preferes la neige ou la glace ?",
        "Tu as deja regarde ?",
        "Tu aimerais apprendre ?",
        "Tu fais du ski ou du snowboard ?",
        "Quelle est ton etape preferee ?",
        "Tu joues a quel poste ?",
        "Tu as passe des ceintures ?",
        "Tu preferes la gym douce ou intense ?",
        "Tu as deja joue ?",
        "Tu aimerais sauter un jour ?",
        "Tu as deja vu un match en direct ?",
        "Tu as deja participe a un tournoi ?",
        "Tu es plutot competitif ou detente ?",
        "Tu fais des figures ?"
    };
    // ============ QUIZ NOURRITURE : questions + reponses + relances ============
    // Comme pour le sport, le meme index relie la question, sa reponse et sa relance.
    std::string questionsNourriture[100] = {
        "T'as faim ?",
        "Qu'est-ce que tu manges ce soir ?",
        "T'aimes la pizza ?",
        "Tu prends un café ?",
        "T'aimes les pates ?",
        "La viande, tu la manges plutot saignante ou bien cuite ?",
        "T'es plutot sale ou sucre ?",
        "T'aimes les sushis ?",
        "Le fromage, t'en manges ?",
        "Tu bois de l'alcool en mangeant ?",
        "T'aimes les legumes ?",
        "Le chocolat, tu le preferes noir ou au lait ?",
        "T'as deja goute des huitres ?",
        "Tu fais la cuisine ou tu commandes ?",
        "Les frites, tu les aimes maison ou surgelees ?",
        "Le petit-dejeuner, tu le prends comment ?",
        "Les plats epices, tu supportes ?",
        "Les fruits de mer, t'aimes ça ?",
        "La soupe, t'en manges en hiver ?",
        "T'as une gourmandise secrete ?",
        "Le pain, tu le prends a chaque repas ?",
        "La salade, tu la manges en entree ou en plat ?",
        "Les patisseries, t'aimes ?",
        "Le poisson, tu le preferes grille ou en sauce ?",
        "T'aimes les hamburgers ?",
        "Le riz, tu le preferes blanc ou complet ?",
        "T'as deja fait un regime ?",
        "Les oeufs, tu les aimes comment ?",
        "La moutarde, t'en mets dans tes plats ?",
        "Les chips, tu les preferes nature ou saveur ?",
        "Le poulet, tu le cuisines souvent ?",
        "Les lasagnes, tu les fais maison ?",
        "T'aimes les plats asiatiques ?",
        "Les crepes, tu les preferes sucrees ou salees ?",
        "La confiture, tu la mets sur quoi ?",
        "Les plats en sauce, t'aimes ?",
        "Les boulettes de viande, tu les manges avec quoi ?",
        "T'aimes la cuisine du monde ?",
        "Les gateaux, tu les fais maison ?",
        "Le popcorn, tu le prends sucre ou sale ?",
        "La charcuterie, t'en manges ?",
        "Les tomates, tu les aimes en salade ou en sauce ?",
        "Les amandes, tu les grignotes souvent ?",
        "Le barbecue, t'aimes ça ?",
        "Les viennoiseries, tu prends quoi ?",
        "Les plats prepares, t'achetes ?",
        "Le the, tu le bois avec quoi ?",
        "Les legumes verts, t'en manges assez ?",
        "La semoule, tu la manges avec quoi ?",
        "T'as un plat qui te rappelle l'enfance ?",
        "T'aimes la cuisine italienne ?",
        "Tu manges des fruits tous les jours ?",
        "T'aimes le fromage ?",
        "Tu cuisines le weekend ?",
        "Tu bois du café au reveil ?",
        "T'aimes les sushis ?",
        "Tu manges des legumes verts ?",
        "T'aimes la viande rouge ?",
        "Tu fais des desserts maison ?",
        "Tu aimes la cuisine epicee ?",
        "Tu manges souvent au restaurant ?",
        "Tu aimes les fruits de mer ?",
        "Tu bois du the ?",
        "T'aimes la pizza ?",
        "Tu manges des legumes chaque jour ?",
        "T'aimes la cuisine asiatique ?",
        "Tu prends un petit-dejeuner copieux ?",
        "T'aimes la soupe ?",
        "Tu fais des barbecues ?",
        "T'aimes les pates au beurre ?",
        "Tu manges du poisson ?",
        "T'aimes les crepes ?",
        "Tu cuisines tous les jours ?",
        "Tu aimes la cuisine francaise ?",
        "Tu manges souvent des salades ?",
        "T'aimes le chocolat ?",
        "Tu bois de l'eau pendant les repas ?",
        "T'aimes les plats en sauce ?",
        "Tu fais des gateaux pour les anniversaires ?",
        "T'aimes les epices ?",
        "Tu manges des cereales le matin ?",
        "T'aimes le pain frais ?",
        "Tu bois du vin ?",
        "T'aimes la moutarde ?",
        "Tu manges des gateaux industriels ?",
        "T'aimes les fruits exotiques ?",
        "Tu fais attention aux calories ?",
        "T'aimes les plats de pates au four ?",
        "Tu manges des legumes surgeles ?",
        "T'aimes la biere ?",
        "Tu manges des patisseries ?",
        "T'aimes les fruits de saison ?",
        "Tu fais de la confiture ?",
        "T'aimes les plats exotiques ?",
        "Tu manges des œufs ?",
        "T'aimes le fromage en raclette ?",
        "Tu bois du jus de fruit ?",
        "T'aimes la cuisine mexicaine ?",
        "Tu manges du pain a chaque repas ?",
        "T'aimes les desserts au chocolat ?"
    };
    std::string reponsesNourriture[100] = {
        "Oui, je commencerais bien par une entree.",
        "Je sais pas encore, je vais voir dans le frigo.",
        "Oh oui, la reine c'est ma preferee.",
        "Oui, un petit noir serre.",
        "J'adore, j'en mangerais tous les jours.",
        "Saignante, ça a plus de gout.",
        "Les deux, mais le sucre c'est mon faible.",
        "Oui, mais surtout ceux au saumon.",
        "Comme dessert, un petit plateau.",
        "Un verre de vin rouge avec la viande.",
        "Oui, mais pas les brocolis.",
        "Noir, avec au moins 70% de cacao.",
        "Une fois, j'ai pas trop aime.",
        "Je cuisine, mais des trucs simples.",
        "Maison, mais je les rate souvent.",
        "Un café et une tartine beurree.",
        "Un peu, mais pas trop fort.",
        "Les crevettes et les moules, oui.",
        "Oui, c'est reconfortant.",
        "Les bonbons acidules.",
        "Oui, un peu de baguette.",
        "En entree, avec une vinaigrette.",
        "Les eclairs et les mille-feuilles.",
        "Grille, c'est plus leger.",
        "Oui, mais pas ceux des fast-foods.",
        "Blanc, le complet est trop sec.",
        "Oui, j'ai tenu 15 jours.",
        "Au plat, avec le jaune coulant.",
        "Oui, dans la vinaigrette.",
        "Sel et vinaigre, c'est mon kiff.",
        "Oui, ça plait a tout le monde.",
        "Oui, avec de la bolognaise et de la bechamel.",
        "Les nouilles sautees et les nems.",
        "Sucrees, avec du Nutella.",
        "Sur une tartine beurree.",
        "Oui, c'est reconfortant.",
        "Avec des pates ou du riz.",
        "Oui, j'adore decouvrir.",
        "Parfois, un gateau au yaourt.",
        "Sale, pour l'apero.",
        "Un peu, du saucisson surtout.",
        "En salade avec de la mozzarella.",
        "Oui, c'est sain et bon.",
        "Oui, entre potes l'ete.",
        "Un pain au chocolat le dimanche.",
        "Rarement, c'est moins bon.",
        "Avec un peu de miel.",
        "Pas assez, je l'avoue.",
        "Avec un tajine ou des legumes.",
        "Les pates au beurre de ma mere.",
        "Oui, les pates et les pizzas.",
        "Oui, une pomme ou une banane.",
        "Oui, le camembert surtout.",
        "Oui, je fais des plats plus elabores.",
        "Oui, sans ça je ne tiens pas.",
        "Oui, surtout ceux au saumon.",
        "Oui, des epinards et des haricots.",
        "Oui, un bon steak.",
        "Oui, des gateaux.",
        "Oui, un peu releve.",
        "Une fois par semaine.",
        "Oui, les crevettes surtout.",
        "Oui, le matin et le soir.",
        "Oh oui, c'est mon plat prefere.",
        "Oui, je varie.",
        "Oui, les sushis et les nems.",
        "Oui, c'est le repas le plus important.",
        "Oui, en hiver surtout.",
        "Oui, en ete entre amis.",
        "Oui, c'est mon plat d'enfance.",
        "Oui, du saumon.",
        "Oui, sucrees surtout.",
        "Non, je commande parfois.",
        "Oui, le bœuf bourguignon.",
        "Oui, en ete.",
        "Oui, j'adore.",
        "Oui, de l'eau plate.",
        "Oui, c'est reconfortant.",
        "Oui, un gateau au chocolat.",
        "Oui, le paprika et le cumin.",
        "Oui, c'est rapide.",
        "Oui, la baguette croustillante.",
        "Oui, un verre de rouge.",
        "Oui, avec la viande.",
        "Non, je prefere les faire maison.",
        "Oui, la mangue et la papaye.",
        "Oui, un peu.",
        "Oui, les lasagnes.",
        "Oui, en hiver.",
        "Oui, une blonde bien fraiche.",
        "Oui, le dimanche.",
        "Oui, c'est meilleur.",
        "Non, j'achete.",
        "Oui, decouvrir de nouvelles saveurs.",
        "Oui, au plat.",
        "Oui, l'hiver.",
        "Oui, presse.",
        "Oui, les tacos.",
        "Oui, c'est une habitude.",
        "Oui, fondant."
    };
    std::string relancesNourriture[100] = {
        "Tu preferes qu'on aille au resto ou tu veux qu'on cuisine ?",
        "T'as des restes ou tu vas commander ?",
        "L'ananas sur la pizza, t'es pour ou contre ?",
        "Avec un sucre ou sans ?",
        "Tu les preferes a la carbonara ou a la bolognaise ?",
        "Et l'agneau, tu l'aimes comment ?",
        "T'as un dessert prefere ?",
        "Tu les trempes dans la sauce soja ou pas ?",
        "T'as un fromage que tu detestes ?",
        "Plutot un Bordeaux ou un Bourgogne ?",
        "Et les epinards, t'en manges ?",
        "Tu manges du chocolat tous les jours ?",
        "Tu les preferes chaudes ou froides ?",
        "T'as une recette fetiche ?",
        "Tu les preferes epaisses ou fines ?",
        "T'es plutot sucre ou sale le matin ?",
        "T'as deja goute un curry thai bien releve ?",
        "Et les bulots, tu manges ?",
        "Plutot potage ou soupe de legumes ?",
        "Tu les manges en cachette ou tu assumes ?",
        "Tu preferes la baguette ou le pain de campagne ?",
        "Avec des croutons ou sans ?",
        "Tu les prends a la boulangerie ou tu les fais ?",
        "Tu l'accompagnes de legumes ou de riz ?",
        "Tu le prends avec quel fromage ?",
        "Tu le manges avec quoi ?",
        "Ça a marche ou t'as craque ?",
        "En omelette, tu mets quoi dedans ?",
        "A l'ancienne ou la classique ?",
        "Tu les manges a l'apero ou devant un film ?",
        "Tu le fais roti, en sauce ou en escalope ?",
        "Tu mets du fromage gratine sur le dessus ?",
        "Tu les commandes ou tu les fais ?",
        "Une crepe salee, tu mets quoi dedans ?",
        "Tu la preferes de quel fruit ?",
        "Tu les prepares a l'avance ou le jour meme ?",
        "Tu les fais a la tomate ou au curry ?",
        "T'as teste un plat africain ou mexicain ?",
        "Tu le parfumes au citron ou au chocolat ?",
        "Et au cinema, tu le prends comment ?",
        "Tu preferes le jambon cru ou cuit ?",
        "Tu les achetes du marche ou du supermarche ?",
        "Tu les preferes grillees ou nature ?",
        "Tu fais plutot des saucisses ou des brochettes ?",
        "Plutot pur beurre ou pas ?",
        "Mais en cas de flemme, tu prends quoi ?",
        "Tu le preferes noir, vert ou fruite ?",
        "Tu essayes de rattraper le week-end ?",
        "Tu la preferes fine ou moyenne ?",
        "Tu les refais aujourd'hui pour te faire plaisir ?",
        "Tu preferes la carbonara ou la bolognaise ?",
        "Tu les achetes au marche ?",
        "Tu le manges chaud ou froid ?",
        "Ta recette preferee ?",
        "Noir ou avec du lait ?",
        "Tu les trempes dans la sauce soja ?",
        "Tu les preferes cuits ou crus ?",
        "Tu le prends saignant ou bien cuit ?",
        "Lequel fais-tu le plus souvent ?",
        "Tu as goute un plat indien ?",
        "Quelle cuisine preferes-tu ?",
        "Tu les preferes chaudes ou froides ?",
        "Vert ou noir ?",
        "Avec quoi tu la prends ?",
        "Tu les achetes frais ou en conserve ?",
        "Tu les commandes ou tu les fais ?",
        "Tu manges quoi le matin ?",
        "Maison ou en brique ?",
        "Tu fais plutot des saucisses ou des brochettes ?",
        "Tu les refais souvent ?",
        "Tu le preferes fume ou grille ?",
        "A la confiture ou au Nutella ?",
        "Tu utilises des livres de recettes ?",
        "Tu as une recette de famille ?",
        "Avec quoi tu l'accompagnes ?",
        "Noir, au lait ou blanc ?",
        "Tu preferes l'eau gazeuse ?",
        "Tu preferes la tomate ou la creme ?",
        "Tu le decores ?",
        "Tu en mets dans tous tes plats ?",
        "Avec du lait ou du yaourt ?",
        "Tu le manges au petit-dejeuner ?",
        "Tu preferes le rouge ou le blanc ?",
        "A l'ancienne ou classique ?",
        "Tu as une marque preferee ?",
        "Tu en achetes souvent ?",
        "Tu comptes tout ce que tu manges ?",
        "Tu les fais maison ou precuits ?",
        "Tu preferes les frais ou les surgeles ?",
        "Artisanale ou industrielle ?",
        "Tu les prends a la boulangerie ?",
        "Tu sais quel fruit est de saison ?",
        "Tu preferes la confiture maison ?",
        "Tu as goute un plat africain ?",
        "Tu les preferes brouilles ?",
        "Tu le fais avec des charcuteries ?",
        "Tu preferes l'orange ou le citron ?",
        "Tu les preferes epices ou doux ?",
        "Tu preferes la baguette ou le pain complet ?",
        "Tu le fais maison ?"
    };

    // ============ QUIZ VOYAGE : questions + reponses + relances ============
    // Comme pour le sport et la nourriture, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsVoyage[100] = {
        "T'es deja alle a l'etranger ?",
        "C'est ou ton plus beau voyage ?",
        "Tu preferes la plage ou la montagne ?",
        "T'as deja fait un voyage en solo ?",
        "La ville ideale pour un week-end ?",
        "Tu voyages plutot en avion ou en train ?",
        "T'as deja dormi dans un hotel de luxe ?",
        "La bouffe locale, tu goutes ou tu restes sur des classiques ?",
        "Les vacances en camping, t'aimes ?",
        "T'as deja voyage avec des amis ?",
        "Quelle destination tu reves de faire ?",
        "Tu preferes visiter des musees ou te balader en ville ?",
        "T'as deja pris l'avion tout seul ?",
        "Le voyage, c'est plutot repos ou decouverte ?",
        "La mer, tu preferes Mediterranee ou Ocean ?",
        "T'as une anecdote de voyage a raconter ?",
        "Les auberges de jeunesse, t'as teste ?",
        "Un pays que tu n'as pas aime ?",
        "Tu voyages leger ou tu prends plein de bagages ?",
        "Les vacances a la mer, t'en fais tous les ans ?",
        "T'as visite Paris ?",
        "Les voyages en groupe organise, t'aimes ?",
        "T'as deja perdu tes bagages ?",
        "Le guide touristique, tu l'achetes ?",
        "Tu preferes la ville ou la campagne en vacances ?",
        "T'as deja fait un voyage en Amerique du Sud ?",
        "Les monuments historiques, tu aimes visiter ?",
        "T'as deja dormi chez l'habitant ?",
        "Le voyage en ferry, t'as teste ?",
        "Un souvenir de voyage que tu gardes precieusement ?",
        "Les marches locaux, tu aimes flaner ?",
        "T'as deja ete en Afrique ?",
        "Les plages de sable fin ou les criques ?",
        "Tu prends des photos ou tu profites ?",
        "T'es deja alle en Asie ?",
        "Les voyages de noces, tu connais ?",
        "T'as deja fait un road-trip ?",
        "Les croisieres, t'as teste ?",
        "Tu voyages avec ta famille ou tes amis ?",
        "Le plus loin que t'aies ete ?",
        "Les sports nautiques, tu pratiques ?",
        "Les voyages de derniere minute, ça te dit ?",
        "T'as une destination qui t'a deçu ?",
        "La montagne en ete, t'aimes ?",
        "Les musees gratuits, tu en profites ?",
        "T'as deja pris un vol avec escale ?",
        "Les souvenirs, tu ramenes quoi ?",
        "Les nuits en train, t'as deja fait ?",
        "T'as visite un lieu qui t'a fait pleurer ?",
        "C'est quoi ton prochain voyage ?",
        "Ou es-tu parti en vacances l'annee derniere ?",
        "Tu preferes l'avion ou le train ?",
        "Tu as une destination de reve ?",
        "Tu voyages leger ou avec beaucoup de bagages ?",
        "Tu es deja alle en Afrique ?",
        "Tu as un souvenir de voyage ?",
        "Tu fais des excursions organisees ?",
        "Tu as visite les Etats-Unis ?",
        "Tu prends des photos en voyage ?",
        "Tu voyages en ete ou en hiver ?",
        "Tu as deja fait un road-trip ?",
        "Tu preferes les plages ou les montagnes ?",
        "Tu voyages avec ta famille ?",
        "Tu as visite des musees en voyage ?",
        "Tu as deja pris un vol long-courrier ?",
        "Tu preferes les hotels ou les Airbnb ?",
        "Tu as perdu tes bagages une fois ?",
        "Tu voyages souvent pour le travail ?",
        "Tu as fait une croisiere ?",
        "Tu as visite des lieux historiques ?",
        "Tu voyages en bus ?",
        "Tu as fait de la randonnee en voyage ?",
        "Tu as visite l'Australie ?",
        "Tu as un itineraire prefere ?",
        "Tu as deja voyage seul ?",
        "Tu as fait du camping en voyage ?",
        "Tu as visite une capitale ?",
        "Tu as pris des souvenirs en voyage ?",
        "Tu as fait des rencontres en voyage ?",
        "Tu as visite des parcs nationaux ?",
        "Tu as fait du tourisme en ville ?",
        "Tu as pris un bateau en voyage ?",
        "Tu as visite l'Asie ?",
        "Tu as des applications de voyage ?",
        "Tu as fait du ski en voyage ?",
        "Tu as visite des villages ?",
        "Tu as fait de la plongee ?",
        "Tu as dormi dans un hotel de luxe ?",
        "Tu as visite l'Europe de l'Est ?",
        "Tu as pris le train de nuit ?",
        "Tu as fait des achats en voyage ?",
        "Tu as visite des eglises en voyage ?",
        "Tu as fait un voyage en groupe ?",
        "Tu as visite un pays etranger ?",
        "Tu as fait du benevolat en voyage ?",
        "Tu as fait une excursion d'une journee ?",
        "Tu as pris des photos avec un appareil professionnel ?",
        "Tu as visite une ile ?",
        "Tu as fait du tourisme durable ?",
        "Tu as une destination favorite en Europe ?"
    };
    std::string reponsesVoyage[100] = {
        "Oui, en Espagne et en Italie surtout.",
        "Le Japon, sans hesiter, tout etait parfait.",
        "La plage, j'adore le soleil et la mer.",
        "Jamais, j'aurais trop peur de m'ennuyer.",
        "Barcelone ou Lisbonne, c'est top.",
        "En train si c'est proche, c'est plus confort.",
        "Une fois, pour une occasion speciale.",
        "Je goute tout, c'est le but du voyage !",
        "Pas trop, je prefere le confort.",
        "Oui, c'est genial mais parfois complique.",
        "Le Canada ou la Nouvelle-Zelande.",
        "Me balader, je decouvre mieux comme ça.",
        "Oui, pour le boulot, c'est rapide.",
        "Les deux, mais je prefere decouvrir.",
        "Mediterranee, l'eau est plus chaude.",
        "Une fois, j'ai rate mon train en Italie.",
        "Oui, quand j'etais etudiant.",
        "L'Angleterre, la meteo m'a deprime.",
        "Plutot leger, une valise cabine.",
        "Oui, c'est mon rituel d'ete.",
        "Oui, mais juste un week-end.",
        "Non, je prefere organiser moi-meme.",
        "Une fois, j'ai attendu 3 jours.",
        "Non, je fais mes recherches sur internet.",
        "La ville, y'a plus d'animations.",
        "Pas encore, mais j'aimerais.",
        "Oui, je trouve ça passionnant.",
        "Oui, en Angleterre, c'etait sympa.",
        "Oui, pour aller en Corse.",
        "Un bracelet achete au Vietnam.",
        "Oh oui, je trouve toujours des pepites.",
        "Non, mais le Maroc est dans ma liste.",
        "Les criques, c'est plus intime.",
        "Les deux, mais j'essaie de profiter surtout.",
        "Oui, en Thailande, c'etait dingue.",
        "Pas encore, mais je prevois quelque chose.",
        "Oui, en Ecosse, c'etait magnifique.",
        "Jamais, j'ai peur d'avoir le mal de mer.",
        "Mes amis, c'est plus detendu.",
        "Les Etats-Unis, la Californie.",
        "Un peu de paddle, mais rien de fou.",
        "Oui, mais je suis trop organise pour ça.",
        "Venise, trop de monde et trop cher.",
        "Oui, pour les randonnees.",
        "Oui, surtout a Londres.",
        "Oui, a Dubaï, j'ai visite 24h.",
        "Des magnets, c'est leger.",
        "Une fois en Suede, j'ai bien dormi.",
        "Auschwitz, j'ai ete bouleverse.",
        "Le Portugal, je veux decouvrir Lisbonne.",
        "En Italie, a Rome.",
        "Le train, plus confortable.",
        "Le Japon.",
        "Leger, une valise cabine.",
        "Non, mais j'aimerais.",
        "Une photo avec des gens rencontres.",
        "Parfois, c'est plus simple.",
        "Oui, New York.",
        "Oui, beaucoup.",
        "En ete, pour la chaleur.",
        "Oui, en Ecosse.",
        "Les plages.",
        "Oui, avec mes enfants.",
        "Oui, le Louvre.",
        "Oui, 8 heures.",
        "Les Airbnb.",
        "Non, jamais.",
        "Oui, plusieurs fois par an.",
        "Non, j'ai peur du mal de mer.",
        "Oui, les pyramides.",
        "Oui, pour les courts trajets.",
        "Oui, en montagne.",
        "Non, mais j'aimerais.",
        "L'Europe du Sud.",
        "Oui, une fois.",
        "Oui, en France.",
        "Oui, Londres.",
        "Oui, des magnets.",
        "Oui, des gens sympas.",
        "Oui, en Amerique.",
        "Oui, a Paris.",
        "Oui, en Grece.",
        "Non, j'aimerais.",
        "Oui, Google Maps.",
        "Oui, dans les Alpes.",
        "Oui, c'est authentique.",
        "Non, j'ai peur.",
        "Une fois, pour une occasion.",
        "Oui, Prague.",
        "Oui, en Europe.",
        "Oui, des souvenirs.",
        "Oui, de belles cathedrales.",
        "Non, je prefere en petit comite.",
        "Oui, plusieurs.",
        "Non, jamais.",
        "Oui, depuis Paris.",
        "Non, avec mon telephone.",
        "Oui, la Corse.",
        "Oui, j'essaie.",
        "L'Italie."
    };
    std::string relancesVoyage[100] = {
        "Et en dehors de l'Europe, t'as tente ?",
        "Ce qui t'a le plus marque la-bas ?",
        "Mais la montagne pour skier, ça te tente ?",
        "Tu tenterais un jour ou trop flippant ?",
        "Tu preferes les capitales ou les petites villes ?",
        "Tu supportes les longs vols ?",
        "Ça vaut le coup ou c'est surfaite ?",
        "T'as deja eu une mauvaise surprise culinaire ?",
        "Meme avec un camping-car, ça te tente ?",
        "Vous vous etes disputes ou tout s'est bien passe ?",
        "Pour les paysages ou pour la culture ?",
        "Mais un musee incontournable, t'en fais quand meme ?",
        "T'as stresse ou t'es tranquille ?",
        "Tu prevois tout ou tu improvises ?",
        "T'es deja alle voir les plages de l'Atlantique ?",
        "Tu t'es retrouve bloque ou ?",
        "Tu y retournerais ou t'es trop vieux maintenant ?",
        "Mais la bouffe, t'as aime ?",
        "T'arrives a tout faire tenir ?",
        "Toujours au meme endroit ou tu changes ?",
        "T'as fait la tour Eiffel ou pas ?",
        "Mais pour des pays compliques, tu tenterais ?",
        "T'as eu des indemnites au moins ?",
        "Tu prepares ton voyage a l'avance ?",
        "Mais la campagne pour se reposer, ça te dit ?",
        "Le Bresil ou l'Argentine te tentent ?",
        "Tu preferes les chateaux ou les cathedrales ?",
        "Tu as garde contact avec eux ?",
        "T'as eu le mal de mer ?",
        "Tu le portes encore ?",
        "T'achetes plutot de la nourriture ou des souvenirs ?",
        "Pour les paysages ou pour la culture ?",
        "Tu te baignes ou tu restes au soleil ?",
        "T'as un bon appareil ou juste ton telephone ?",
        "Tu as visite Bangkok ou plutot les plages ?",
        "Plutot exotique ou europeen ?",
        "Tu preferes la voiture ou le camping-car ?",
        "Mais ça te tente un jour ?",
        "Tu partirais en vacances avec tes parents maintenant ?",
        "T'as fait la cote Est aussi ?",
        "T'as deja essaye le surf ?",
        "T'as deja tout annule pour partir ?",
        "Mais t'y retournerais en hiver ?",
        "T'as deja fait une grosse randonnee de plusieurs jours ?",
        "T'as vu le British Museum ?",
        "Tu conseilles de faire escale ou vol direct ?",
        "T'as une collection chez toi ?",
        "Tu preferes le train couchette ou l'avion ?",
        "T'avais prepare cette visite ou c'etait impulsif ?",
        "Tu pars quand et avec qui ?",
        "Tu as visite le Colisee ?",
        "Tu prends le train pour les longues distances ?",
        "Pour la culture ou la nourriture ?",
        "Tu arrives a tout faire tenir ?",
        "Le Maroc ou l'Afrique du Sud ?",
        "Tu gardes contact ?",
        "Tu preferes explorer par toi-meme ?",
        "Tu as fait la statue de la Liberte ?",
        "Tu les imprimes ou tu les gardes sur ton telephone ?",
        "Tu fais du ski en hiver ?",
        "Tu loues une voiture ?",
        "Tu te baignes souvent ?",
        "Tu voyages avec tes amis ?",
        "Lequel t'as le plus marque ?",
        "Tu supportes bien ?",
        "Tu preferes le confort ou l'authenticite ?",
        "Tu as eu des retards ?",
        "Tu en profites pour visiter ?",
        "Ça te tente ?",
        "Qu'est-ce qui t'a le plus impressionne ?",
        "Tu preferes le bus ou le train ?",
        "C'etait dur ?",
        "Tu veux voir les kangourous ?",
        "Pourquoi cette region ?",
        "Tu as aime l'experience ?",
        "Tu as dormi a la belle etoile ?",
        "Quelle capitale t'as le plus plu ?",
        "Tu as une collection ?",
        "Tu gardes contact avec eux ?",
        "Lequel etait le plus beau ?",
        "Tu as visite la tour Eiffel ?",
        "Tu as eu le mal de mer ?",
        "La Chine ou le Japon ?",
        "Tu prepares ton itineraire ?",
        "Tu as pris des cours ?",
        "Lequel t'as plu ?",
        "Tu aimerais essayer ?",
        "Ça vaut le prix ?",
        "Tu as aime ?",
        "C'etait confortable ?",
        "Tu as rapporte quelque chose de precieux ?",
        "Laquelle t'as le plus impressionne ?",
        "Tu as deja voyage avec un groupe ?",
        "Lequel t'as le plus marque ?",
        "Ça te tente ?",
        "Ou es-tu alle ?",
        "Tu preferes les photos ou les souvenirs ?",
        "C'etait paradisiaque ?",
        "Qu'est-ce que tu fais pour l'environnement ?",
        "Qu'est-ce qui te plait le plus ?"
    };

    // ============ QUIZ MUSIQUE : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsMusique[100] = {
        "T'ecoutes quel style de musique ?",
        "C'est qui ton chanteur prefere ?",
        "Tu joues d'un instrument ?",
        "T'es deja alle a un concert ?",
        "Tu preferes ecouter en streaming ou acheter des CDs ?",
        "La musique en voiture, tu mets quoi ?",
        "T'aimes le rap ?",
        "La musique classique, t'en ecoutes ?",
        "T'as une chanson que tu ecoutes en boucle ?",
        "Les festivals de musique, t'aimes ?",
        "La tele-realite musicale, tu regardes ?",
        "T'as une playlist pour faire du sport ?",
        "Les paroles, tu les ecoutes ou juste la melodie ?",
        "Tu preferes la musique actuelle ou des vieux tubes ?",
        "T'as un artiste que tu detestes ?",
        "Tu vas au karaoke ?",
        "La musique, tu en ecoutes en travaillant ?",
        "T'as un souvenir musical d'enfance ?",
        "Les clips video, tu regardes ?",
        "La musique en live, c'est mieux qu'en studio ?",
        "T'es plutot chanteur ou rappeur ?",
        "Les comedies musicales, t'aimes ?",
        "La musique de film, tu l'ecoutes ?",
        "T'as deja ecrit une chanson ?",
        "Le reggae, tu connais ?",
        "Les groupes de rock, t'en ecoutes ?",
        "La country, t'aimes ?",
        "L'electro, t'en ecoutes en soiree ?",
        "T'as un instrument que tu voudrais apprendre ?",
        "Les chansons d'amour, t'aimes ?",
        "La musique traditionnelle de ton pays, t'en ecoutes ?",
        "Les reprises, t'aimes ?",
        "T'as deja vu un spectacle musical ?",
        "La musique au casque ou enceinte ?",
        "T'as une chanson qui te donne la peche ?",
        "Les balades chantees, t'aimes ?",
        "La musique de fond, tu mets quoi ?",
        "T'as un groupe que tu suis depuis longtemps ?",
        "La musique sacree, t'en ecoutes ?",
        "T'achetes des places de concert a l'avance ?",
        "Le jazz, tu connais ?",
        "Les TikTok dance, tu les ecoutes ?",
        "T'as une playlist pour la route ?",
        "La musique d'ambiance, tu mets quoi ?",
        "T'as un chef d'orchestre prefere ?",
        "Les enfants, ils ecoutent quoi chez toi ?",
        "T'as deja danse sur une chanson sans rien ?",
        "Les paroles, tu les retiens facilement ?",
        "T'as une chanson qui te fait fondre ?",
        "La musique, c'est important dans ta vie ?",
        "Tu ecoutes quel genre de musique ?",
        "T'as une chanson qui te donne la peche ?",
        "Tu vas a des concerts ?",
        "Tu ecoutes du jazz ?",
        "Tu preferes les vieilles chansons ou les nouvelles ?",
        "Tu joues d'un instrument ?",
        "T'aimes la musique classique ?",
        "Tu ecoutes la radio ?",
        "Les comedies musicales, t'aimes ?",
        "Tu as des ecouteurs sans fil ?",
        "Tu ecoutes de la musique en travaillant ?",
        "Tu as une playlist pour la route ?",
        "Tu aimes le rap ?",
        "Tu danses sur la musique ?",
        "Tu ecoutes des podcasts musicaux ?",
        "Tu preferes le streaming ou les CD ?",
        "Tu connais des artistes locaux ?",
        "Tu as une chanson qui te rappelle un souvenir ?",
        "Tu ecoutes de la musique en faisant du sport ?",
        "Tu preferes la musique instrumentale ou avec paroles ?",
        "Tu as un karaoke prefere ?",
        "Tu ecoutes de la musique dans la langue que tu ne comprends pas ?",
        "Tu aimes les remixes ?",
        "Tu ecoutes du blues ?",
        "Tu as des ecouteurs ou un casque ?",
        "Tu preferes les chansons connues ou les decouvertes ?",
        "Tu ecoutes de la musique avant de dormir ?",
        "Tu connais des orchestres symphoniques ?",
        "Tu as une playlist pour la fete ?",
        "Tu ecoutes des musiques du monde ?",
        "Tu preferes les concerts en interieur ou en exterieur ?",
        "Tu aimes les paroles profondes ?",
        "Tu as une chaine YouTube musicale preferee ?",
        "Tu ecoutes des bandes originales de films ?",
        "Tu as un artiste local a decouvrir ?",
        "Tu ecoutes de la musique traditionnelle ?",
        "Tu preferes les albums ou les singles ?",
        "Tu as un morceau que tu ecoutes en boucle ?",
        "Tu fais des decouvertes musicales sur les reseaux ?",
        "Tu aimes les duos ?",
        "Tu ecoutes de la musique en lisant ?",
        "Tu as une chanson d'amour preferee ?",
        "Tu connais des instruments traditionnels ?",
        "Tu ecoutes des comptines ?",
        "Tu aimes les chœurs ?",
        "Tu preferes les voix aigues ou graves ?",
        "Tu ecoutes de la musique en voiture ?",
        "Tu as des albums physiques ?",
        "Tu preferes les chansons en majorite ou en minorite ?",
        "Tu ecoutes de la musique pour te detendre ?"
    };
    std::string reponsesMusique[100] = {
        "Un peu de tout, mais surtout du rock.",
        "Stromae, je trouve qu'il est hyper creatif.",
        "La guitare, mais je suis debutant.",
        "Oui, plusieurs, c'est toujours une tuerie.",
        "Streaming, c'est plus pratique.",
        "De la musique qui donne envie de chanter.",
        "Oui, certains rappeurs, pas tous.",
        "Parfois, pour me detendre.",
        "Oui, \"Bohemian Rhapsody\", je m'en lasse pas.",
        "J'adore l'ambiance, j'en fais un par an.",
        "Pas trop, je trouve ça trop formate.",
        "Oui, du rock et de l'electro.",
        "Les deux, mais la melodie d'abord.",
        "Les vieux tubes, ça a plus d'ame.",
        "Pas vraiment, mais certains me fatiguent.",
        "Oui, mais apres quelques verres.",
        "Oui, ça m'aide a me concentrer.",
        "Les CD de mon pere dans la voiture.",
        "Parfois, quand ils sont bien faits.",
        "Carrement, l'energie est incroyable.",
        "Chanteur, j'aime les melodies.",
        "Oui, j'ai vu \"Les Miserables\".",
        "Oui, j'adore les bandes originales.",
        "Jamais, mais j'aimerais essayer.",
        "Oui, Bob Marley, un classique.",
        "Queen, AC/DC, les classiques.",
        "Un peu, mais ça me rappelle les westerns.",
        "Oui, c'est parfait pour danser.",
        "Le piano, c'est tellement elegant.",
        "Oui, j'assume, ça fait du bien.",
        "Parfois, pour les fetes.",
        "Oui, quand elles apportent un truc nouveau.",
        "Oui, une comedie musicale a Paris.",
        "Casque, j'entends mieux les details.",
        "\"Happy\" de Pharrell Williams.",
        "Oui, c'est doux.",
        "Du jazz ou du lounge.",
        "Coldplay, depuis le debut.",
        "Pas vraiment, ça me semble trop solennel.",
        "Oui, pour les grosses tetes d'affiche.",
        "Un peu, j'aime l'ambiance.",
        "Non, ça m'enerve vite.",
        "Oui, des chansons qui donnent envie de partir.",
        "De l'electro ou du chill.",
        "Pas vraiment, je connais moins.",
        "Du rap, ça me fait marrer.",
        "Oui, je me lache.",
        "Pas du tout, je suis nul.",
        "\"Imagine\" de John Lennon.",
        "Oui, c'est mon echappatoire.",
        "Du rock et de la pop.",
        "\"Happy\" de Pharrell.",
        "Oui, des que je peux.",
        "Un peu, pour me detendre.",
        "Les vieilles, ça a plus d'ame.",
        "Oui, de la guitare.",
        "Oui, Beethoven.",
        "En voiture, parfois.",
        "Oui, j'ai vu \"Les Miserables\".",
        "Oui, c'est pratique.",
        "Oui, ça m'aide a me concentrer.",
        "Oui, des chansons entrainantes.",
        "Oui, certains rappeurs.",
        "Oui, en soiree.",
        "Non, plutot des livres audio.",
        "Le streaming, c'est plus pratique.",
        "Oui, il y a des groupes sympas.",
        "Oui, l'ete dernier.",
        "Oui, ça motive.",
        "Avec paroles.",
        "Oui, en soiree.",
        "Oui, parfois, la melodie suffit.",
        "Oui, ça change les chansons.",
        "Oui, c'est emouvant.",
        "Un casque, plus confortable.",
        "Les decouvertes.",
        "Non, ça me reveille.",
        "Oui, j'ai assiste a un concert.",
        "Oui, de l'electro.",
        "Oui, de l'afrobeat.",
        "En exterieur, en ete.",
        "Oui, quand elles ont un sens.",
        "Oui, des reprises.",
        "Oui, certaines sont magnifiques.",
        "Oui, je les soutiens.",
        "Oui, pour les fetes.",
        "Les albums, une histoire.",
        "Oui, en ce moment.",
        "Oui, sur Instagram.",
        "Oui, les voix se completent.",
        "Non, ça me distrait.",
        "Oui, une chanson romantique.",
        "Oui, la guitare flamenca.",
        "Avec les enfants.",
        "Oui, c'est puissant.",
        "Les deux, selon le style.",
        "Oui, toujours.",
        "Oui, quelques CD.",
        "En majorite, c'est joyeux.",
        "Oui, du jazz."
    };
    std::string relancesMusique[100] = {
        "Et la variete francaise, t'aimes ?",
        "Et en international, tu prends qui ?",
        "T'as appris tout seul ou en cours ?",
        "Le meilleur, c'etait lequel ?",
        "T'as des vinyles chez toi ?",
        "Tu chantes ou tu ecoutes en silence ?",
        "T'ecoutes du rap francais ou americain ?",
        "Tu connais Beethoven ou Mozart ?",
        "Tu l'ecoutes en cachette ou tu l'assumes ?",
        "T'as deja fait les Vieilles Charrues ou Coachella ?",
        "Mais The Voice, t'as deja regarde ?",
        "Ça te motive ou ça te distrait ?",
        "T'as deja pleure sur une chanson ?",
        "Annees 80 ou annees 90, tu choisis quoi ?",
        "Qui te fatigue le plus en ce moment ?",
        "Ta chanson fetiche au karaoke ?",
        "Tu mets des ecouteurs ou tu mets l'ambiance ?",
        "Tu les ecoutes encore aujourd'hui ?",
        "T'as un clip qui t'a marque ?",
        "T'as deja vu un live qui t'a deçu ?",
        "Mais un peu de rap, ça te gene pas ?",
        "T'as aime ou tu t'es ennuye ?",
        "Laquelle est ta preferee ?",
        "Tu la mettrais sur quel style ?",
        "T'ecoutes du reggae pour te detendre ?",
        "Tu preferes le rock anglais ou americain ?",
        "T'as un artiste de country que tu connais ?",
        "T'as un DJ prefere ?",
        "T'as deja essaye ?",
        "T'as une chanson d'amour qui te fait voyager ?",
        "T'as un instrument traditionnel prefere ?",
        "Une reprise meilleure que l'original ?",
        "T'as prefere la musique ou les decors ?",
        "Tu mets le volume a fond ?",
        "Tu la mets quand t'es triste ?",
        "T'as une balade preferee ?",
        "Tu l'ecoutes en faisant a manger ?",
        "Tu les as vus en concert ?",
        "Mais les chants gregoriens, t'as deja teste ?",
        "Tu prends les tarifs VIP ou les places classiques ?",
        "T'as un jazzman prefere ?",
        "T'en as des preferees ou c'est non ?",
        "Tu l'actualises souvent ?",
        "Plutot pour les soirees ou pour le repos ?",
        "Mais tu vas au concert symphonique ?",
        "Tu les laisses ou tu imposes tes gouts ?",
        "T'as honte ou tu assumes ?",
        "Mais tu chantes quand meme faux ?",
        "Tu l'ecoutes en boucle ?",
        "Tu pourrais vivre sans musique ?",
        "Quel est ton groupe prefere ?",
        "Tu la mets quand tu es triste ?",
        "Le dernier que t'as fait ?",
        "Tu as un musicien prefere ?",
        "Annees 80 ou 90 ?",
        "Tu as appris tout seul ?",
        "Tu as une œuvre preferee ?",
        "Quelle station ?",
        "Tu as prefere la musique ou les decors ?",
        "Tu les utilises au sport ?",
        "Tu mets des ecouteurs ?",
        "Tu l'actualises souvent ?",
        "Francais ou americain ?",
        "Un style de danse que t'aimes ?",
        "Tu as une chaine a recommander ?",
        "Tu as des vinyles ?",
        "Tu les as deja vus en concert ?",
        "Lequel ?",
        "Quel genre ?",
        "Tu ecoutes les paroles ou la melodie ?",
        "Ta chanson fetichiste ?",
        "Quelle langue ?",
        "Un remix que t'aimes ?",
        "Tu as un artiste prefere ?",
        "Tu l'utilises chez toi ou dehors ?",
        "Ou trouves-tu de nouvelles musiques ?",
        "Tu ecoutes des berceuses ?",
        "Quelle œuvre ?",
        "Tu la fais toi-meme ?",
        "Tu as un artiste a recommander ?",
        "T'as deja ete a un festival ?",
        "Une chanson qui t'a fait reflechir ?",
        "Tu les ecoutes souvent ?",
        "Quelle BO preferes-tu ?",
        "Tu les as vus en concert ?",
        "Quelle tradition ?",
        "Tu ecoutes les albums en entier ?",
        "Lequel ?",
        "Tu suis des comptes de musique ?",
        "Un duo celebre que t'aimes ?",
        "Tu preferes le silence ?",
        "Laquelle ?",
        "Tu as un instrument prefere ?",
        "Tu en connais une par cœur ?",
        "Un chœur que t'as entendu ?",
        "Tu as un chanteur prefere ?",
        "Avec qui tu chantes ?",
        "Tu les ecoutes encore ?",
        "Une chanson triste que t'aimes ?",
        "Ça te fait du bien ?"
    };

    // ============ QUIZ CULTURE : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsCulture[100] = {
        "T'aimes lire ?",
        "C'est ton film prefere ?",
        "Tu vas au musee ?",
        "La culture, c'est important pour toi ?",
        "T'aimes le theatre ?",
        "Les expositions d'art, tu connais ?",
        "T'as une passion culturelle ?",
        "Les traditions de ton pays, tu les respectes ?",
        "T'ecoutes des podcasts culturels ?",
        "Les jeux video, c'est de la culture pour toi ?",
        "La danse, t'en fais ?",
        "La photo, c'est un art pour toi ?",
        "Tu connais bien l'histoire de ton pays ?",
        "Les contes et legendes, t'aimes ?",
        "La sculpture, ça t'interesse ?",
        "T'as une citation preferee ?",
        "Les fetes traditionnelles, tu les celebres ?",
        "La culture d'un pays, ça se voit surtout ou ?",
        "T'as un tableau prefere ?",
        "Les livres audio, tu connais ?",
        "La culture pop, t'aimes ?",
        "Le street-art, c'est de l'art pour toi ?",
        "Les monuments historiques, tu visites ?",
        "Tu regardes des documentaires ?",
        "Les langues etrangeres, tu parles lesquelles ?",
        "La poesie, t'aimes ?",
        "Les arts martiaux, c'est culturel ?",
        "Le design, ça t'interesse ?",
        "Les series TV, c'est de la culture ?",
        "La culture de l'entreprise, ça te parle ?",
        "Les festivals culturels, tu en fais ?",
        "La mythologie, t'aimes ?",
        "Les livres de developpement personnel, tu lis ?",
        "La culture generale, tu l'entretiens ?",
        "Les costumes traditionnels, ça te plait ?",
        "La musique classique, c'est culturel ?",
        "Les arts de la scene, t'aimes ?",
        "La gastronomie, c'est culturel ?",
        "Les rituels familiaux, tu les aimes ?",
        "La calligraphie, t'aimes ?",
        "Les arts visuels, tu preferes quoi ?",
        "La culture numerique, ça existe ?",
        "Les livres historiques, tu lis ?",
        "La poterie, c'est de l'artisanat ?",
        "Les proverbes, t'en utilises ?",
        "Le cinema muet, t'as vu ?",
        "Les danses traditionnelles, t'en connais ?",
        "La culture des reseaux sociaux, ça t'interesse ?",
        "Les autoportraits, tu connais ?",
        "La culture, ça se transmet comment ?",
        "Tu lis des livres ?",
        "Tu vas au musee ?",
        "Tu connais les traditions de ton pays ?",
        "Tu regardes des documentaires ?",
        "T'aimes le theatre ?",
        "Tu connais l'histoire de ta region ?",
        "T'aimes la poesie ?",
        "Tu as une œuvre d'art preferee ?",
        "Tu suis des chaines culturelles a la tele ?",
        "Tu as un patrimoine familial ?",
        "Tu vas a des expositions ?",
        "Tu connais des legendes locales ?",
        "Tu ecoutes des conferences ?",
        "Tu regardes des films d'auteur ?",
        "Tu as des livres chez toi ?",
        "Tu connais des danses traditionnelles ?",
        "Tu visites des chateaux ?",
        "Tu ecoutes de la musique traditionnelle ?",
        "Tu connais des ecrivains de ton pays ?",
        "Tu vas a des festivals culturels ?",
        "Tu as un musee prefere ?",
        "Tu connais des contes populaires ?",
        "Tu regardes des emissions historiques ?",
        "Tu as des traditions culinaires ?",
        "Tu connais des peintres celebres ?",
        "Tu vas a des salons du livre ?",
        "Tu ecoutes des conferences TED ?",
        "Tu connais des dialectes locaux ?",
        "Tu as des objets d'art chez toi ?",
        "Tu vas a des pieces de theatre ?",
        "Tu connais des mythes locaux ?",
        "Tu regardes des films historiques ?",
        "Tu as un livre d'histoire a recommander ?",
        "Tu ecoutes des contes pour enfants ?",
        "Tu as des traditions religieuses ?",
        "Tu connais des architectes celebres ?",
        "Tu visites des monuments historiques ?",
        "Tu as un patrimoine oral ?",
        "Tu ecoutes de la musique classique en direct ?",
        "Tu as des livres rares chez toi ?",
        "Tu connais des sculpteurs celebres ?",
        "Tu as une bibliotheque personnelle ?",
        "Tu regardes des documentaires artistiques ?",
        "Tu as un tableau que tu aimes chez toi ?",
        "Tu vas a des representations de danse ?",
        "Tu connais des ecrivains contemporains ?",
        "Tu as des traditions musicales locales ?",
        "Tu vas a des spectacles de rue ?",
        "Tu connais des artistes locaux ?",
        "Tu as un livre de poesie chez toi ?"
    };
    std::string reponsesCulture[100] = {
        "Oui, mais j'ai du mal a trouver le temps.",
        "\"Le Parrain\", un chef-d'oeuvre.",
        "Parfois, quand il y a une expo qui m'interesse.",
        "Oui, ça ouvre l'esprit.",
        "Oui, j'y vais de temps en temps.",
        "Un peu, je prefere l'art moderne.",
        "Le cinema, je regarde au moins un film par semaine.",
        "Oui, surtout pendant les fetes.",
        "Oui, en voiture, j'apprends plein de trucs.",
        "Oui, carrement, il y a des histoires geniales.",
        "Je danse en soiree, c'est tout.",
        "Oui, une belle photo raconte une histoire.",
        "Le principal, mais pas tous les details.",
        "Oui, j'adore les histoires du Moyen Age.",
        "Oui, Michel-Ange, c'est un genie.",
        "\"Connais-toi toi-meme\" de Socrate.",
        "Oui, c'est l'occasion de retrouver la famille.",
        "Dans la bouffe, l'art et les mentalites.",
        "La Nuit etoilee de Van Gogh.",
        "Oui, c'est pratique quand je conduis.",
        "Oui, j'adore les references aux films et series.",
        "Oui, Banksy est incroyable.",
        "Quand je voyage, c'est un incontournable.",
        "Oui, des docu-nature surtout.",
        "L'anglais et un peu d'espagnol.",
        "Pas trop, je la trouve difficile a comprendre.",
        "Oui, c'est un melange de sport et de philosophie.",
        "Un peu, surtout en architecture.",
        "Oui, ça fait partie de la pop culture.",
        "Oui, c'est important pour le travail.",
        "Oui, comme le festival du film.",
        "Oui, la mythologie grecque est passionnante.",
        "Parfois, ça m'aide a reflechir.",
        "Oui, en lisant des articles.",
        "Oui, ils sont souvent magnifiques.",
        "Oui, c'est le fondement de la musique.",
        "Oui, le cirque et le theatre de rue.",
        "Totalement, chaque pays a sa cuisine.",
        "Oui, ça cree des souvenirs.",
        "Oui, c'est un art magnifique.",
        "La peinture ou la photographie.",
        "Oui, internet a cree une culture a part.",
        "Oui, pour comprendre le present.",
        "Oui, c'est un savoir-faire ancestral.",
        "Oui, \"Paris ne s'est pas fait en un jour\".",
        "Oui, Charlie Chaplin c'est genial.",
        "La salsa ou le tango.",
        "Oui, c'est interessant mais fatiguant.",
        "Oui, comme ceux de Van Gogh ou Frida Kahlo.",
        "Par la parole, les livres et les traditions.",
        "Oui, des romans.",
        "Oui, quand il y a des expos.",
        "Oui, les fetes locales.",
        "Oui, sur la nature.",
        "Oui, j'y vais de temps en temps.",
        "Un peu, les grandes dates.",
        "Oui, Rimbaud.",
        "La Joconde.",
        "Arte, parfois.",
        "Des objets anciens.",
        "Oui, d'art contemporain.",
        "Oui, des histoires de fantomes.",
        "Oui, en ligne.",
        "Oui, des films francais.",
        "Oui, une bibliotheque.",
        "Oui, la bourree.",
        "Oui, c'est impressionnant.",
        "Oui, pour les fetes.",
        "Oui, Victor Hugo.",
        "Oui, de musique.",
        "Le Louvre.",
        "Oui, Le Petit Chaperon Rouge.",
        "Oui, sur les guerres.",
        "Oui, la galette des rois.",
        "Oui, Van Gogh.",
        "Oui, j'achete des livres.",
        "Oui, inspirantes.",
        "Oui, le patois.",
        "Oui, des sculptures.",
        "Oui, de temps en temps.",
        "Oui, la legende du serpent.",
        "Oui, pour apprendre.",
        "Oui, \"Histoire mondiale\".",
        "Oui, le soir.",
        "Oui, les fetes catholiques.",
        "Oui, Le Corbusier.",
        "Oui, a chaque voyage.",
        "Oui, des histoires de famille.",
        "Oui, a l'opera.",
        "Oui, des editions anciennes.",
        "Oui, Michel-Ange.",
        "Oui, je collectionne.",
        "Oui, sur la peinture.",
        "Oui, une reproduction.",
        "Oui, du ballet.",
        "Oui, Leila Slimani.",
        "Oui, des chants.",
        "Oui, en ete.",
        "Oui, des peintres.",
        "Oui, de Baudelaire."
    };
    std::string relancesCulture[100] = {
        "Tu preferes les romans ou les documentaires ?",
        "Et en comedie, tu prends quoi ?",
        "T'as visite le Louvre ?",
        "Tu fais des efforts pour t'informer ?",
        "Tu preferes la comedie ou le drame ?",
        "Et l'art classique, ça te parle ?",
        "Plutot cine ou plateforme ?",
        "Laquelle est ta preferee ?",
        "Tu peux m'en recommander un ?",
        "T'as un jeu qui t'a marque ?",
        "T'as deja pris des cours ?",
        "Tu prends des photos toi-meme ?",
        "Une periode qui te passionne ?",
        "T'en as une a raconter ?",
        "T'as vu le David en vrai ?",
        "Elle t'aide au quotidien ?",
        "Laquelle est la plus importante pour toi ?",
        "T'as un pays ou la culture t'a surpris ?",
        "Tu l'as vu en vrai ?",
        "Tu preferes lire ou ecouter ?",
        "T'as une reference qui te fait rire ?",
        "T'as deja vu un graffiti qui t'a marque ?",
        "T'as un monument qui t'a bluffe ?",
        "T'as un docu a recommander ?",
        "Tu veux en apprendre une autre ?",
        "Mais un poeme connu, tu connais ?",
        "T'en as deja pratique un ?",
        "T'as un batiment qui te fascine ?",
        "Ta serie preferee ?",
        "Tu connais une entreprise avec une culture forte ?",
        "Lequel est le plus sympa ?",
        "Tu connais Zeus ou Poseidon ?",
        "T'as un livre a conseiller ?",
        "Tu fais des quiz culturels ?",
        "T'as un costume traditionnel chez toi ?",
        "T'ecoutes un compositeur en particulier ?",
        "T'as vu un spectacle de rue ?",
        "Une specialite qui t'a marque ?",
        "Lequel est le plus important ?",
        "T'as essaye d'en faire ?",
        "T'as une expo que tu veux voir ?",
        "T'as une commu en ligne ?",
        "Une periode qui te fascine ?",
        "T'as deja fait un stage ?",
        "Un proverbe que tu dis souvent ?",
        "T'as aime le style ?",
        "Tu voudrais apprendre laquelle ?",
        "T'as un reseau prefere ?",
        "Lequel est le plus connu ?",
        "Tu transmets quelque chose, toi ?",
        "Quel genre de livres ?",
        "Quelle exposition t'as le plus aimee ?",
        "Laquelle est ta preferee ?",
        "Sur quel sujet ?",
        "Quelle piece t'as vu ?",
        "Quel grand evenement connais-tu ?",
        "Un poeme que tu connais ?",
        "Ou est-elle ?",
        "Une emission a recommander ?",
        "Un objet qui vient d'ou ?",
        "Quel artiste t'as marque ?",
        "Raconte-la moi.",
        "Quel theme ?",
        "Lequel ?",
        "Combien de livres ?",
        "Tu as deja participe ?",
        "Lequel t'as plu ?",
        "Quelle musique ?",
        "Lequel ?",
        "Quel festival ?",
        "Pourquoi lui ?",
        "Lequel ?",
        "Quelle periode ?",
        "Laquelle ?",
        "Lequel ?",
        "Un auteur rencontre ?",
        "Laquelle ?",
        "Lequel ?",
        "Quelle piece ?",
        "Laquelle ?",
        "Lequel ?",
        "Lequel ?",
        "Ou l'as-tu trouve ?",
        "Lequel ?",
        "Laquelle ?",
        "Quel monument ?",
        "Lequel ?",
        "Lequel ?",
        "Quel concert ?",
        "Une reliure ?",
        "Lequel ?",
        "Tu les ranges par auteur ?",
        "Lequel ?",
        "Une piece unique ?",
        "Quelle troupe ?",
        "Lequel ?",
        "Quelle tradition ?",
        "Quel spectacle ?",
        "Lequel ?",
        "Un poeme a partager ?"
    };

    // ============ QUIZ TRAVAIL : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsTravail[100] = {
        "Tu fais quoi dans la vie ?",
        "T'aimes ton boulot ?",
        "Tu bosses a quel horaire ?",
        "Tes collegues, ils sont sympas ?",
        "Ton patron, il est comment ?",
        "Tu bosses en equipe ou en solo ?",
        "Le teletravail, tu en fais ?",
        "T'as deja eu un burnout ?",
        "Tu gagnes bien ta vie ?",
        "Les reunions, t'aimes ?",
        "T'as deja change de metier ?",
        "La pause dejeuner, tu fais quoi ?",
        "Les RTT, tu les prends ou tu les cumules ?",
        "T'as un metier physique ou sedentaire ?",
        "Tu stresses avant une presentation ?",
        "Le boulot t'empeche de dormir ?",
        "T'as des bons souvenirs de ton premier job ?",
        "Les entretiens d'embauche, tu redoutes ?",
        "Ta boite, elle est grande ou petite ?",
        "Les horaires flexibles, t'en profites ?",
        "Les pauses, tu les prends vraiment ?",
        "T'as un collegue que tu supportes pas ?",
        "La formation continue, tu fais ?",
        "Les objectifs de chiffre, tu les atteins ?",
        "Le travail a la maison, c'est mieux ?",
        "Les pots de depart, t'y vas ?",
        "T'as des primes ou des bonus ?",
        "Tu penses a ta retraite ?",
        "Tu fais des heures supplementaires ?",
        "Les clients, ils sont cools ?",
        "Les mails, tu reponds tout de suite ?",
        "Les reunions Zoom, t'en as marre ?",
        "T'as un metier passion ou alimentaire ?",
        "Les nouvelles technologies, tu suis ?",
        "La politique de la boite, ça t'interesse ?",
        "Les voyages pro, t'en fais ?",
        "Tu discutes du salaire avec tes collegues ?",
        "Les stagiaires, tu les encadres ?",
        "Le 35h, tu les fais vraiment ?",
        "Tu prends tes conges l'ete ?",
        "Les collegues, tu les vois en dehors ?",
        "T'as un rituel le matin au boulot ?",
        "Le repas du midi, tu le prends vite ?",
        "Les notes de frais, t'en fais ?",
        "Les formations obligatoires, t'aimes ?",
        "T'as un metier compatible avec la famille ?",
        "Les moments de stress, tu les geres comment ?",
        "Le licenciement, ça te fait peur ?",
        "L'avancement, tu veux grimper ?",
        "Le travail, ça te definit ?",
        "Tu fais quoi dans la vie ?",
        "Tu aimes ton metier ?",
        "Tu travailles seul ou en equipe ?",
        "Tu as des collegues sympas ?",
        "Tu es de quel secteur ?",
        "Tu as des horaires de bureau ?",
        "Tu es freelance ou salarie ?",
        "Tu as un bureau ou tu bouges ?",
        "Tu changes souvent de travail ?",
        "Tu as une reconversion en tete ?",
        "Tu prends des pauses dans la journee ?",
        "Tu as un manager cool ?",
        "Tu travailles le weekend ?",
        "Tu as des formations en cours ?",
        "Tu fais des heures sup' ?",
        "Tu as une routine du matin ?",
        "Tu as des objectifs au travail ?",
        "Tu evalues tes performances ?",
        "Tu as un comite d'entreprise ?",
        "Tu fais du teletravail ?",
        "Tu as une tenue de travail ?",
        "Tu manges au travail ?",
        "Tu as des avantages ?",
        "Tu fais des reunions ?",
        "Tu as un projet en cours ?",
        "Tu travailles en open space ?",
        "Tu as des deplacements pro ?",
        "Tu fais des presentations ?",
        "Tu as un ordinateur fourni ?",
        "Tu utilises quels logiciels ?",
        "Tu as des deadlines stressantes ?",
        "Tu as un badge d'acces ?",
        "Tu fais des teambuildings ?",
        "Tu as des pauses cafe ?",
        "Tu as des reunions en visio ?",
        "Tu as un calendrier charge ?",
        "Tu as un patron exigeant ?",
        "Tu as des objectifs d'equipe ?",
        "Tu as un contrat stable ?",
        "Tu as des augmentations ?",
        "Tu as une prime ?",
        "Tu as un CDI ?",
        "Tu as des congés payes ?",
        "Tu as une mutuelle ?",
        "Tu as un parking ?",
        "Tu as une cantine ?",
        "Tu as des tickets resto ?",
        "Tu as une carriere de reve ?",
        "Tu as un CV a jour ?",
        "Tu as des representants du personnel ?"
    };
    std::string reponsesTravail[100] = {
        "Je travaille dans le marketing digital.",
        "Oui, globalement, mais y'a des jours sans.",
        "Du 9h a 18h, avec une pause le midi.",
        "Oui, l'ambiance est plutot bonne.",
        "Pas trop severe, mais il exige des resultats.",
        "En equipe, on se repartit les taches.",
        "Oui, quelques jours par semaine.",
        "Non, mais j'ai frole pendant le covid.",
        "Ça va, je m'en sors correctement.",
        "Non, ça dure toujours trop longtemps.",
        "Oui, j'ai fait une reconversion.",
        "Je mange au resto avec des collegues.",
        "Je les pose, je suis pas un martyr.",
        "Sedentaire, 8h devant l'ordi.",
        "Oui, les 5 minutes avant sont horribles.",
        "Parfois, quand j'ai trop de dossiers en tete.",
        "Oui, l'ambiance etait festive.",
        "Je deteste ça, je stresse trop.",
        "Une PME d'une centaine de personnes.",
        "Oui, j'arrive a 10h si je veux.",
        "15 minutes le matin et l'apres-midi.",
        "Un petit peu, il parle trop.",
        "Oui, j'apprends des trucs en ligne.",
        "La plupart du temps, oui.",
        "Oui, mais on se sent isole parfois.",
        "Oui, c'est important de dire au revoir.",
        "Oui, en fin d'annee.",
        "Pas trop, c'est tellement loin.",
        "De temps en temps, mais je les recupere.",
        "La majorite, mais y'en a des relous.",
        "Non, j'attends d'avoir une reponse reflechie.",
        "Oui, je prefere en vrai.",
        "Un peu les deux, mais je kiffe quand meme.",
        "Pas trop, je suis un peu a la ramasse.",
        "Pas trop, je me concentre sur mes dossiers.",
        "Un ou deux par an.",
        "Pas directement, c'est tabou.",
        "Oui, c'est cool de transmettre.",
        "En theorie, mais en pratique c'est plus.",
        "Oui, je bloque deux semaines en aout.",
        "De temps en temps, pour un verre.",
        "Arriver, cafe, checker les mails.",
        "Non, je prends une vraie pause.",
        "Oui, pour les deplacements.",
        "Pas trop, ça me fait perdre du temps.",
        "Oui, les horaires sont cools.",
        "Respiration et pause cafe.",
        "Un peu, je pense a l'avenir.",
        "Oui, mais pas a n'importe quel prix.",
        "Non, c'est une partie de ma vie.",
        "Je suis developpeur web.",
        "Oui, c'est passionnant.",
        "En equipe, surtout.",
        "Oui, on s'entend bien.",
        "L'informatique.",
        "Oui, 9h a 18h.",
        "Salarie.",
        "Un bureau, en open space.",
        "Non, je suis stable.",
        "Peut-etre un jour.",
        "Oui, de vraies pauses.",
        "Oui, il est cool.",
        "Parfois, en periode de rush.",
        "Oui, des cours en ligne.",
        "Pas trop, j'organise.",
        "Oui, du sport.",
        "Oui, chaque mois.",
        "Oui, je fais le point.",
        "Oui, c'est un plus.",
        "Oui, deux jours par semaine.",
        "Non, tenue libre.",
        "Oui, a la cantine.",
        "Oui, une mutuelle.",
        "Oui, des reunions d'equipe.",
        "Oui, un gros projet.",
        "Oui, c'est bruyant.",
        "Parfois, a Paris.",
        "Oui, des demos.",
        "Oui, un PC portable.",
        "VSCode et Git.",
        "Oui, mais gerables.",
        "Oui, un badge.",
        "Oui, une fois par an.",
        "Oui, des pauses cafe.",
        "Oui, des visios hebdomadaires.",
        "Oui, toujours rempli.",
        "Oui, il est exigeant.",
        "Oui, des objectifs clairs.",
        "Oui, un CDI.",
        "Oui, chaque annee.",
        "Oui, une prime annuelle.",
        "Oui, depuis 5 ans.",
        "Oui, 25 jours.",
        "Oui, une bonne mutuelle.",
        "Oui, un parking.",
        "Oui, une cantine sympa.",
        "Oui, des tickets resto.",
        "Devenir tech lead.",
        "Oui, je le mets a jour.",
        "Oui, des delegues."
    };
    std::string relancesTravail[100] = {
        "C'est interessant ou tu t'ennuies parfois ?",
        "Ce que tu preferes, c'est quoi ?",
        "T'arrives a etre productif toute la journee ?",
        "Y'en a un qui t'enerve un peu ?",
        "Tu lui fais confiance ou tu stresses avec lui ?",
        "Tu preferes travailler seul ou avec d'autres ?",
        "Tu preferes le bureau ou la maison ?",
        "Comment tu fais pour decompresser ?",
        "T'aimerais gagner combien pour etre tranquille ?",
        "T'arrives a rester concentre ou tu decroches ?",
        "C'etait quoi avant ?",
        "Vous parlez boulot ou vous coupez ?",
        "Tu les prends en week-end prolonge ?",
        "Tu fais du sport a cote pour compenser ?",
        "Une fois lance, ça va mieux ?",
        "Tu arrives a decrocher le week-end ?",
        "Tu gardes contact avec certains ?",
        "T'as une question qui t'a coince ?",
        "Tu preferes les grandes ou petites structures ?",
        "Tu commences tot ou t'es plutot couche-tard ?",
        "Cafe, clope ou rien ?",
        "Tu lui dis ou tu gardes pour toi ?",
        "Ça t'aide a evoluer ou c'est juste pour toi ?",
        "Et si tu les rates, ça se passe comment ?",
        "Tu arrives a te concentrer sans collegues ?",
        "Tu restes pour le verre ou tu te casses ?",
        "Ça te motive a donner plus ?",
        "Tu te vois continuer jusqu'a quel age ?",
        "Tu les fais pour le fric ou pour le boulot ?",
        "Ta technique pour gerer les relous ?",
        "T'as des mails qui restent en \"non lu\" ?",
        "Ta camera, tu l'allumes ou tu la caches ?",
        "Si t'avais les moyens, tu ferais quoi ?",
        "Ça t'inquiete pour ton metier ?",
        "T'ecoutes les reunions ou tu decroches ?",
        "Tu en profites pour visiter ?",
        "Tu devrais en parler, on dit que c'est utile.",
        "T'as un stagiaire qui t'a marque ?",
        "Tu compenses comment ?",
        "Tu te deconnectes completement ?",
        "Vous etes vraiment amis ou juste collegues ?",
        "Si le cafe est en panne, c'est la catastrophe ?",
        "En 15 minutes ou en une heure ?",
        "Tu cumules ou tu declares tout de suite ?",
        "Tu en as une qui t'a servi ?",
        "Tu arrives a emmener les enfants a l'ecole ?",
        "Tu craques parfois ou tu tiens bon ?",
        "T'as un plan B en tete ?",
        "Tu prepares le prochain poste ?",
        "Tu arrives a laisser le boulot au bureau ?",
        "Depuis combien de temps ?",
        "Qu'est-ce qui te plait le plus ?",
        "Tu prefères quel mode ?",
        "Vous faites quoi ensemble ?",
        "C'est quoi ton role exact ?",
        "Tu arrives a deconnecter ?",
        "Tu kiffes ce statut ?",
        "Tu aimerais un bureau prive ?",
        "Tu cherches un poste stable ?",
        "Dans quel domaine ?",
        "Tu sors marcher ?",
        "Il te pousse ?",
        "Tu recuperes quand ?",
        "Lesquelles ?",
        "Ça arrive souvent ?",
        "Quelle routine ?",
        "Tu les atteins ?",
        "Comment tu mesures ?",
        "Tu en profites ?",
        "Tu prefères quel jour ?",
        "Quelle tenue ?",
        "Tu manges equilibre ?",
        "Lequel ?",
        "Elles durent combien de temps ?",
        "Raconte-moi.",
        "Tu t'y habitues ?",
        "Ou ca ?",
        "Tu es a l'aise ?",
        "Il est rapide ?",
        "Tu les maitrises ?",
        "Comment tu gères ?",
        "Tu l'utilises souvent ?",
        "Tu y vas souvent ?",
        "Tu discutes de quoi ?",
        "Avec qui ?",
        "Il est plein a quel point ?",
        "Il te stresse ?",
        "Tu les suis ?",
        "Il est de quelle duree ?",
        "Depuis quand ?",
        "Elle est grosse ?",
        "Tu es tranquille ?",
        "Tu poses quand ?",
        "Elle couvre quoi ?",
        "Il est proche ?",
        "Tu y manges ?",
        "Tu les utilises ?",
        "Quelle étape vises-tu ?",
        "Tu postules où ?",
        "Tu les sollicites souvent ?"
    };

    // ============ QUIZ SANTE : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsSante[100] = {
        "Tu fais attention a ta sante ?",
        "Tu dors combien d'heures par nuit ?",
        "T'as des douleurs quelque part en ce moment ?",
        "Tu manges des fruits et legumes tous les jours ?",
        "Tu bois assez d'eau ?",
        "T'as deja fait un regime ?",
        "Le sport, t'en fais ?",
        "Tu stresses beaucoup ?",
        "Tu prends des vitamines ?",
        "T'as mal a la tete souvent ?",
        "Le cafe, tu bois combien par jour ?",
        "T'as deja eu un probleme de sante grave ?",
        "Tu te laves les mains souvent ?",
        "Le sommeil, c'est important pour toi ?",
        "Tu fais des check-ups medicaux ?",
        "T'as des allergies ?",
        "La nourriture bio, t'y crois ?",
        "Tu fumes ?",
        "L'alcool, t'en bois ?",
        "Les ecrans, tu les supportes bien ?",
        "T'as mal au dos souvent ?",
        "Les complements alimentaires, tu prends ?",
        "Tu bois du the aussi ?",
        "T'as deja fait une greve de la faim ?",
        "Le sucre, t'en manges beaucoup ?",
        "Tu fais du sport en salle ou dehors ?",
        "T'as des problemes de digestion ?",
        "La medecine douce, t'y crois ?",
        "Tu manges a heures fixes ?",
        "Les medicaments, t'en prends souvent ?",
        "Les pates, tu en manges beaucoup ?",
        "T'as deja eu une intoxication alimentaire ?",
        "Le mental, ça joue sur ta sante ?",
        "Les bienfaits du sport, tu les ressens ?",
        "Tu prends soin de ta peau ?",
        "Les yaourts, t'en manges ?",
        "Les douleurs articulaires, tu connais ?",
        "T'as des problemes de vue ?",
        "Le poisson, t'en manges ?",
        "Les bonnes resolutions sante, tu les tiens ?",
        "Le fromage, ça fait grossir ?",
        "La fatigue chronique, tu connais ?",
        "Les jus de fruits, c'est bon pour la sante ?",
        "Les regimes a la mode, tu suis ?",
        "Les antibiotiques, tu en abuses ?",
        "Les massages, tu aimes ?",
        "La soupe en hiver, c'est bon ?",
        "L'humidite, ça te fait tousser ?",
        "La sante mentale, c'est tabou pour toi ?",
        "C'est quoi ton secret pour rester en forme ?",
        "Tu dors combien de temps ?",
        "Tu fais du sport souvent ?",
        "Tu manges equilibre ?",
        "Tu bois assez d'eau ?",
        "Tu consultes un medecin regulierement ?",
        "Tu prends des vitamines ?",
        "Tu fais des bilans de sante ?",
        "Tu evites le sucre ?",
        "Tu marches beaucoup ?",
        "Tu as un poids stable ?",
        "Tu fumes ?",
        "Tu bois de l'alcool ?",
        "Tu as des allergies ?",
        "Tu prends des medicaments ?",
        "Tu as des douleurs chroniques ?",
        "Tu fais des etirements ?",
        "Tu as une bonne posture ?",
        "Tu proteges ta peau du soleil ?",
        "Tu regardes des ecrans la nuit ?",
        "Tu manges a des heures regulieres ?",
        "Tu as un suivi dentaire ?",
        "Tu fais des examens de vue ?",
        "Tu as un sommeil profond ?",
        "Tu pratiques la meditation ?",
        "Tu as des tensions musculaires ?",
        "Tu bois du cafe en trop ?",
        "Tu fais des siestes ?",
        "Tu aimes cuisiner sain ?",
        "Tu as une alimentation bio ?",
        "Tu fais des check-ups annuels ?",
        "Tu as une bonne hygiene ?",
        "Tu es attentif a ton stress ?",
        "Tu fais du yoga ?",
        "Tu as une routine de soins ?",
        "Tu t'hydrates en faisant du sport ?",
        "Tu as un suivi cardiologique ?",
        "Tu surveilles ta tension ?",
        "Tu as une bonne circulation ?",
        "Tu prends l'air regulierement ?",
        "Tu fais des exercices de respiration ?",
        "Tu as un rythme de vie sain ?",
        "Tu evites les fast-food ?",
        "Tu cuisines maison ?",
        "Tu as un bon equilibre mental ?",
        "Tu fais des cures de vitamines ?",
        "Tu es attentif a ton souffle ?",
        "Tu as des nuits reparatrices ?",
        "Tu fais du sport en groupe ?",
        "Tu as un coach sportif ?",
        "Tu consultes des specialistes ?"
    };
    std::string reponsesSante[100] = {
        "Oui, j'essaie de manger equilibre.",
        "Environ 7 heures, c'est pas mal.",
        "Le dos, a force de rester assis.",
        "Oui, mais pas assez, je l'avoue.",
        "Pas assez, je bois surtout du cafe.",
        "Oui, j'ai tenu 15 jours.",
        "Un peu de course a pied.",
        "Oui, surtout au travail.",
        "En hiver, oui, pour eviter les maladies.",
        "Parfois, a cause de l'ecran.",
        "3 ou 4, j'essaie de reduire.",
        "Non, quelques petits trucs, mais rien de mechant.",
        "Oui, surtout quand je rentre.",
        "C'est ma priorite, sans ça je suis mort.",
        "Une fois par an, comme tout le monde.",
        "Oui, au pollen, c'est l'enfer au printemps.",
        "Oui, mais c'est trop cher.",
        "Non, j'ai arrete il y a 2 ans.",
        "Un verre de temps en temps.",
        "Mes yeux fatiguent le soir.",
        "Oui, a cause de la mauvaise posture.",
        "Parfois, de la vitamine D.",
        "Oui, le matin et le soir.",
        "Non, je tiendrais pas une journee.",
        "Trop, j'ai un gros faible.",
        "Dehors, le parc a cote de chez moi.",
        "Parfois, quand je mange trop gras.",
        "L'osteopathie, oui, ça m'a aide.",
        "Pas trop, je grignote souvent.",
        "Non, seulement quand je suis malade.",
        "Oui, c'est mon plat reconfort.",
        "Une fois, j'ai regrette un restaurant.",
        "Totalement, stress = fatigue.",
        "Oui, je dors mieux apres.",
        "Pas trop, je mets juste de la creme.",
        "Oui, le matin au petit-dej.",
        "Les genoux qui craquent, oui.",
        "Je porte des lunettes pour conduire.",
        "Une fois par semaine.",
        "15 jours, puis j'oublie.",
        "Oui, mais c'est trop bon.",
        "Oui, le rythme de vie est dur.",
        "Oui, mais il faut les presser.",
        "Non, je trouve ça trop contraignant.",
        "Non, je suis raisonnable.",
        "Oui, c'est tellement relaxant.",
        "Oui, ça rechauffe.",
        "Oui, l'hiver je fais une bronchite.",
        "Non, je pense qu'il faut en parler.",
        "Dormir, manger varie, bouger.",
        "Environ 7 heures.",
        "Oui, trois fois par semaine.",
        "Oui, je fais attention.",
        "Oui, 1,5 litre par jour.",
        "Oui, une fois par an.",
        "Oui, de la vitamine D.",
        "Oui, tous les ans.",
        "Oui, je limite.",
        "Oui, je marche beaucoup.",
        "Oui, il est stable.",
        "Non, jamais.",
        "Tres peu, en occasion.",
        "Oui, au pollen.",
        "Oui, un traitement.",
        "Oui, au dos.",
        "Oui, le matin.",
        "Oui, je fais attention.",
        "Oui, de la creme solaire.",
        "Parfois, c'est un mauvais reflexe.",
        "Oui, a heures fixes.",
        "Oui, tous les 6 mois.",
        "Oui, tous les 2 ans.",
        "Oui, la plupart du temps.",
        "Oui, j'essaie de respirer.",
        "Oui, au niveau du cou.",
        "Non, deux cafés par jour.",
        "Oui, le weekend.",
        "Oui, j'aime ça.",
        "Oui, quand je peux.",
        "Oui, chaque annee.",
        "Oui, je me lave bien.",
        "Oui, je fais du sport.",
        "Oui, une fois par semaine.",
        "Oui, une routine peau.",
        "Oui, avant et apres.",
        "Oui, j'ai fait un test.",
        "Oui, je la surveille.",
        "Oui, je pense.",
        "Oui, tous les jours.",
        "Oui, je pratique.",
        "Oui, je dors et mange bien.",
        "Oui, je me restreins.",
        "Oui, tous les soirs.",
        "Oui, je me sens bien.",
        "Oui, en hiver.",
        "Oui, je respire bien.",
        "Oui, je recupere bien.",
        "Oui, en club de course.",
        "Oui, j'ai un coach.",
        "Oui, si besoin."
    };
    std::string relancesSante[100] = {
        "Mais tu craques parfois sur un burger ?",
        "Tu arrives a te reveiller sans cafe ?",
        "Tu fais des etirements ou tu subis ?",
        "Tu preferes les fruits ou les legumes ?",
        "Tu as une bouteille d'eau sur ton bureau ?",
        "Ça a marche ou t'as craque ?",
        "Combien de fois par semaine ?",
        "T'as des techniques pour decompresser ?",
        "Tu preferes les gelules ou les ampoules ?",
        "Tu prends des medicaments ou tu attends ?",
        "Tu le bois noir ou avec du lait ?",
        "Tu vas chez le medecin regulierement ?",
        "Tu utilises du gel hydroalcoolique ?",
        "Tu te couches toujours a la meme heure ?",
        "Tu prends rendez-vous ou tu oublies ?",
        "Tu prends des antihistaminiques ?",
        "Tu achetes des fruits bio parfois ?",
        "T'as galere a arreter ?",
        "Plutot vin, biere ou cocktail ?",
        "Tu mets des lunettes anti-lumiere bleue ?",
        "Tu as une chaise ergonomique ?",
        "Tu sens la difference ?",
        "Plutot vert ou noir ?",
        "T'as deja jeune ?",
        "Tu as essaye d'arreter ?",
        "Tu preferes le cardio ou la muscu ?",
        "Tu prends des probiotiques ?",
        "T'as deja teste l'acupuncture ?",
        "Tu sautes des repas des fois ?",
        "Tu preferes les naturels ?",
        "Completes ou blanches ?",
        "T'as passe la journee aux toilettes ?",
        "Tu fais de la meditation ?",
        "Le sport te vide la tete ?",
        "Tu vas voir un dermato ?",
        "Plutot nature ou aux fruits ?",
        "Tu fais des exercices pour les genoux ?",
        "Tu as essaye les lentilles ?",
        "Plutot du saumon ou de la truite ?",
        "Tu reprends chaque annee ?",
        "Tu en manges tous les jours ?",
        "Tu fais des siestes ?",
        "Tu preferes orange ou citron ?",
        "Tu as deja teste un truc bizarre ?",
        "Tu finis toujours le traitement ?",
        "Tu en prends regulierement ?",
        "Maison ou en brique ?",
        "Tu achetes un humidificateur ?",
        "Tu en parles facilement ?",
        "Tu t'y tiens tous les jours ?",
        "Ca te suffit ?",
        "Quel sport ?",
        "Tu craques parfois ?",
        "Tu as une gourde ?",
        "Quel medecin ?",
        "Lesquelles ?",
        "Quels examens ?",
        "Tu aimes le sucré ?",
        "Combien de pas ?",
        "Tu le surveilles ?",
        "Tu comptes arreter ?",
        "Tu as deja exagere ?",
        "Lesquelles ?",
        "Depuis quand ?",
        "Tu fais quoi pour ça ?",
        "Tu t'etires quand ?",
        "Tu corriges comment ?",
        "Tu mets de la creme ?",
        "Tu mets un filtre bleu ?",
        "Tu sautes des repas ?",
        "Tu as un dentiste ?",
        "Tu as une correction ?",
        "Tu te reposes ?",
        "Ca t'aide ?",
        "Tu masse tes epaules ?",
        "Combien de cafés ?",
        "A quelle heure ?",
        "Quel plat ?",
        "Tu le trouves cher ?",
        "Qui t'ausculte ?",
        "Tu fais un check-up ?",
        "Comment tu gères ?",
        "En salle ou chez toi ?",
        "Ta routine ?",
        "Tu bois pendant ?",
        "Tu as fait un ECG ?",
        "Tu as un tensiometre ?",
        "Tu fais des massages ?",
        "Tu fais des promenades ?",
        "Tu pratiques souvent ?",
        "Tu changes de rythme ?",
        "Quelle frequence ?",
        "Quel plat fait maison ?",
        "Ca se voit dans ton humeur ?",
        "Tu les prends comment ?",
        "Tu fais du cardio ?",
        "Tu te leves frais ?",
        "Avec des amis ?",
        "Il est certifie ?",
        "Quels specialistes ?"
    };

    // ============ QUIZ PERSONNALITE : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsPersonnalite[100] = {
        "T'es plutot introverti ou extraverti ?",
        "T'es plutot matinal ou couche-tard ?",
        "T'es optimiste ou pessimiste ?",
        "Tu es tetu ?",
        "Tu es plutot spontane ou tu reflechis beaucoup ?",
        "T'es patient ou impatient ?",
        "Tu es sensible ?",
        "T'es quelqu'un de fiable ?",
        "T'es plutot leader ou suiveur ?",
        "Tu as le sens de l'humour ?",
        "T'es du genre a t'inquieter pour tout ?",
        "Tu es loyal en amitie ?",
        "Tu es plutot reserve ou tu parles facilement de toi ?",
        "T'es un perfectionniste ?",
        "Tu es du genre a ruminer ou a passer a autre chose ?",
        "Tu es plutot calme ou nerveux ?",
        "Tu es organise ou bordelique ?",
        "Tu as confiance en toi ?",
        "Tu es du genre a prendre des risques ?",
        "Tu es plutot taiseux ou bavard ?",
        "Tu es du genre a faire le premier pas ?",
        "T'es rancunier ?",
        "Tu es plutot serieux ou fun ?",
        "Tu es du genre a aimer les defis ?",
        "Tu es une personne emotionnelle ?",
        "Tu es du genre a tout planifier ?",
        "Tu es plutot terre-a-terre ou reveur ?",
        "Tu es du genre a dire ce que tu penses ?",
        "Tu es plutot genereux ou econome ?",
        "Tu es une personne intuitive ?",
        "Tu es du genre a t'adapter facilement ?",
        "Tu es plutot solitaire ou toujours entoure ?",
        "Tu es une personne curieuse ?",
        "Tu es du genre a aider les autres ?",
        "Tu es plutot masculin ou feminin dans ton style ? (sans jugement)",
        "Tu es du genre a t'ennuyer souvent ?",
        "Tu es une personne fidele en amour ?",
        "Tu es du genre a tout controler ?",
        "Tu es plutot modeste ou tu t'assumes ?",
        "Tu es une personne joyeuse ?",
        "Tu es du genre a mentir parfois ?",
        "Tu es plutot pragmatique ou idealiste ?",
        "Tu es une personne jalouse ?",
        "Tu es du genre a aimer les surprises ?",
        "Tu es plutot calme en voiture ou nerveux ?",
        "Tu es une personne de valeurs ?",
        "Tu es du genre a ecouter les autres ?",
        "Tu es une personne qui aime le changement ?",
        "Tu es plutot nostalgique ou tourne vers l'avenir ?",
        "Si tu devais te decrire en un mot ?",
        "Tu es optimiste ?",
        "Tu es patient ?",
        "Tu es organise ?",
        "Tu es spontane ?",
        "Tu es perfectionniste ?",
        "Tu es curieux ?",
        "Tu es independant ?",
        "Tu es timide ?",
        "Tu es aventurier ?",
        "Tu es exigeant envers toi-meme ?",
        "Tu es genereux ?",
        "Tu es fiable ?",
        "Tu es creatif ?",
        "Tu es discipliné ?",
        "Tu es sociable ?",
        "Tu es tolerant ?",
        "Tu es ambitieux ?",
        "Tu es calme ?",
        "Tu es decide ?",
        "Tu es observateur ?",
        "Tu es resistant au stress ?",
        "Tu es changeant ?",
        "Tu es pragmatique ?",
        "Tu es idealiste ?",
        "Tu es modeste ?",
        "Tu es critique ?",
        "Tu es enthousiaste ?",
        "Tu es prudent ?",
        "Tu es analytique ?",
        "Tu es spontané ou reflechi ?",
        "Tu es direct ?",
        "Tu es flexible ?",
        "Tu es colereux ?",
        "Tu es jovial ?",
        "Tu es resistant ?",
        "Tu es passionne ?",
        "Tu es stable ?",
        "Tu es ouvert d'esprit ?",
        "Tu es detaille ?",
        "Tu es rapide ?",
        "Tu es methodique ?",
        "Tu es solitaire ?",
        "Tu es curieux de tout ?",
        "Tu es decide dans tes choix ?",
        "Tu es emotionnel ?",
        "Tu es logique ?",
        "Tu es impulsif ?",
        "Tu es prudent dans tes decisions ?",
        "Tu es autonome ?",
        "Tu es adaptable ?"
    };
    std::string reponsesPersonnalite[100] = {
        "Plutot introverti, j'ai besoin de temps seul.",
        "Couche-tard, je suis plus productif le soir.",
        "Optimiste, je vois toujours le bon cote.",
        "Un peu, mais je sais ecouter.",
        "Je reflechis trop, j'analyse tout.",
        "Pas tres patient, j'aime que ça aille vite.",
        "Oui, je pleure facilement devant un film.",
        "Je pense oui, je tiens toujours mes promesses.",
        "Je peux etre leader, mais j'aime aussi deleguer.",
        "Oui, je fais rire les gens facilement.",
        "Oui, je stresse meme pour des trucs futiles.",
        "Totalement, je suis toujours la pour mes potes.",
        "Reserve, mais avec les bonnes personnes je m'ouvre.",
        "Oui, j'aime que tout soit bien fait.",
        "Je rumine, je ressasse les trucs.",
        "Plutot calme, mais ça m'arrive de peter les plombs.",
        "Un peu bordelique, mais je retrouve tout.",
        "Pas toujours, ça depend des situations.",
        "Non, je suis plutot prudent.",
        "Bavard avec mes proches, taiseux avec les inconnus.",
        "Non, j'attends que l'autre vienne.",
        "Pas trop, je laisse couler.",
        "Fun, mais je sais etre serieux quand il faut.",
        "Oui, ça me motive a me depasser.",
        "Oui, je ressens les choses intensement.",
        "Oui, j'aime avoir un plan.",
        "Reveur, j'aimerais voyager tout le temps.",
        "Oui, je suis franc.",
        "Genereux, j'aime faire plaisir.",
        "Oui, je sens vite si quelqu'un est sincere.",
        "Oui, je m'adapte a l'ambiance.",
        "J'aime les deux, mais j'ai besoin de solitude.",
        "Oui, j'adore apprendre des trucs.",
        "Oui, j'essaie toujours d'etre utile.",
        "Plutot neutre, j'assume les deux.",
        "Non, je trouve toujours a m'occuper.",
        "Oui, pour moi la fidelite est essentielle.",
        "Un peu, j'aime savoir ou je vais.",
        "Modeste, je n'aime pas me vanter.",
        "En general oui, je vois la vie en rose.",
        "Des petits mensonges pour eviter les conflits.",
        "Idealiste, j'espere un monde meilleur.",
        "Un peu, surtout en amour.",
        "Oui, quand c'est une bonne surprise.",
        "Nerveux avec les mauvais conducteurs.",
        "Oui, la famille et l'honnetete, c'est mon socle.",
        "Oui, j'aime savoir ce qu'ils pensent.",
        "Oui, le changement me fait grandir.",
        "Un peu nostalgique, mais je regarde devant.",
        "Perseverant, j'abandonne jamais.",
        "Oui, je vois le positif.",
        "Oui, j'attends.",
        "Oui, je planifie.",
        "Oui, j'aime l'improviste.",
        "Oui, trop parfois.",
        "Oui, je pose des questions.",
        "Oui, j'aime être seul.",
        "Un peu, au debut.",
        "Oui, j'aime découvrir.",
        "Oui, je me depasse.",
        "Oui, j'aime partager.",
        "Oui, on peut compter sur moi.",
        "Oui, j'ecris.",
        "Oui, j'ai des routines.",
        "Oui, j'aime les gens.",
        "Oui, j'accepte les differences.",
        "Oui, j'ai des projets.",
        "Oui, en général.",
        "Oui, je tranche.",
        "Oui, je remarque tout.",
        "Oui, je relativise.",
        "Parfois, selon les jours.",
        "Oui, je raisonne.",
        "Oui, je crois en mes ideaux.",
        "Oui, je reste discret.",
        "Oui, je me remets en question.",
        "Oui, j'aime la vie.",
        "Oui, je reflechis.",
        "Oui, j'analyse.",
        "Oui, je reflechis avant.",
        "Oui, je suis franc.",
        "Oui, je m'adapte.",
        "Parfois, mais ça passe.",
        "Oui, j'aime rire.",
        "Oui, je tiens le coup.",
        "Oui, j'aime ce que je fais.",
        "Oui, je suis constant.",
        "Oui, j'ecoute les avis.",
        "Oui, je suis precis.",
        "Oui, je suis efficace.",
        "Oui, je suis carre.",
        "Oui, j'aime le calme.",
        "Oui, tout m'interesse.",
        "Oui, j'assume.",
        "Oui, je ressens fort.",
        "Oui, je raisonne.",
        "Oui, parfois trop.",
        "Oui, je pese le pour et contre.",
        "Oui, je decide seul.",
        "Oui, je m'adapte facilement."
    };
    std::string relancesPersonnalite[100] = {
        "Tu te forces a sortir parfois ou tu assumes ?",
        "Le matin, t'es un zombie ?",
        "Meme quand tout va mal, tu relativises ?",
        "Un exemple ou t'as lache prise ?",
        "Ça t'arrive de regretter de pas avoir ete spontane ?",
        "Dans les bouchons, tu petes un cable ?",
        "Tu l'assumes ou tu caches ?",
        "Et si t'arrives pas a tenir, tu prevenis ?",
        "Dans un projet, tu prends les renes ?",
        "Plutot second degre ou humour lourd ?",
        "T'as des techniques pour te calmer ?",
        "T'as deja ete trahi par un pote ?",
        "Ça te prend du temps de faire confiance ?",
        "Ça te ronge quand c'est pas parfait ?",
        "Ça t'empeche de dormir parfois ?",
        "Ce qui te fait peter les plombs, c'est quoi ?",
        "Un bureau range, c'est pas pour toi ?",
        "Dans quel domaine tu te sens le plus a l'aise ?",
        "Une fois, t'as pris un risque qui a paye ?",
        "En soiree, t'es celui qui anime ou qui ecoute ?",
        "En amour, t'oses pas souvent ?",
        "Mais si quelqu'un te fait un sale coup, tu oublies ?",
        "Au travail, tu es different qu'entre potes ?",
        "T'as un defi recent que t'as releve ?",
        "Ça te joue des tours parfois ?",
        "Une fois, t'as tout change au dernier moment ?",
        "T'as des reves que t'aimerais realiser ?",
        "Des fois, ça cree des conflits ?",
        "Tu regrettes parfois tes depenses ?",
        "Tu te trompes souvent ?",
        "Dans une nouvelle ville, tu trouves tes reperes vite ?",
        "Tu as des activites que tu fais seul ?",
        "T'as un sujet qui te passionne en ce moment ?",
        "Des fois, on profite de toi ?",
        "Tu te sens a l'aise avec cette facette ?",
        "Ce qui t'ennuie le plus ?",
        "T'as deja ete trompe ?",
        "Une situation ou t'as perdu le controle ?",
        "Une fierte que tu caches ?",
        "Ce qui te rend vraiment heureux ?",
        "Est-ce que ça te pese ?",
        "Tu agis pour le changer ou tu esperes ?",
        "Tu arrives a controler ça ?",
        "Une surprise qui t'a marque ?",
        "Tu fais des road-rage des fois ?",
        "Tu les imposes aux autres ?",
        "Les gens viennent te parler facilement ?",
        "Un changement difficile que t'as vecu ?",
        "Une epoque qui te manque ?",
        "Est-ce que tes amis diraient la meme chose ?",
        "Quand ça va mal ?",
        "Dans les files d'attente ?",
        "Tu planifies tout ?",
        "Tu regrettes parfois ?",
        "Ça t'enerve ?",
        "Sur quels sujets ?",
        "Depuis longtemps ?",
        "Tu te forces a parler ?",
        "Quelle est ta derniere aventure ?",
        "Tu te mets la pression ?",
        "Avec qui ?",
        "Qui te fait confiance ?",
        "Dans quel domaine ?",
        "Quelle routine ?",
        "Tu preferes petit comite ?",
        "Avec qui ?",
        "Quel objectif ?",
        "Ça se voit ?",
        "Tu mets du temps ?",
        "Tu remarques quoi en premier ?",
        "Comment tu te detends ?",
        "Qu'est-ce qui change ?",
        "Un exemple ?",
        "Tu crois au mieux ?",
        "Tu laisses parler les autres ?",
        "Tu dis tout ?",
        "Qu'est-ce qui t'excite ?",
        "Tu prends des risques ?",
        "Tu analyses quoi ?",
        "Tu balances d'abord ?",
        "Ça passe mal parfois ?",
        "Tu t'adaptes vite ?",
        "Qu'est-ce qui te fache ?",
        "Tu fais rire qui ?",
        "Dans quel domaine ?",
        "Ta passion ?",
        "Depuis combien de temps ?",
        "Tu changes d'avis ?",
        "Tu es maniaque ?",
        "Tu agis vite ?",
        "Tu suis un plan ?",
        "Tu t'ennuies seul ?",
        "Qu'est-ce qui te retient ?",
        "Tu assumes tes choix ?",
        "Tu le montres ?",
        "Tu suis ta tete ?",
        "Tu le regrettes ?",
        "Tu consultes qui ?",
        "Tu veux aider ?",
        "Ça t'aide dans ta vie ?"
    };

    // ============ QUIZ TECH : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsTech[100] = {
        "T'as quel telephone ?",
        "Tu passes combien de temps sur ton telephone ?",
        "T'es sur les reseaux sociaux ?",
        "Les ordinateurs, t'y connais quoi ?",
        "L'intelligence artificielle, ça te fait peur ?",
        "Les jeux video, t'en fais ?",
        "Tu fais du streaming ?",
        "Les montres connectees, t'en as une ?",
        "Les voitures electriques, t'en veux une ?",
        "Les drones, t'as deja pilote ?",
        "La 5G, tu l'as ?",
        "Tu sauvegardes tes photos ou ?",
        "Les assistants vocaux, t'en utilises ?",
        "T'as un ordinateur fixe ou un portable ?",
        "Les abonnements en ligne, t'en as combien ?",
        "Les applications de rencontre, t'as teste ?",
        "Le teletravail, c'est grace a la technologie ?",
        "Les enceintes connectees, t'en as ?",
        "Les e-books, tu lis sur liseuse ?",
        "Le Metaverse, ça te tente ?",
        "Les cryptomonnaies, t'en as ?",
        "Les smartphones pliables, t'as vu ?",
        "Les ecrans tactiles, tu preferes ?",
        "Les reseaux sociaux, tu passes du temps ?",
        "Le piratage, ça t'inquiete ?",
        "Les nouvelles technologies, tu suis ?",
        "Les imprimantes 3D, t'en as une ?",
        "La domotique, t'as installe ?",
        "Les cyberattaques, ça te fait peur ?",
        "Les trackers de sport, t'utilises ?",
        "Les tablettes, t'en as une ?",
        "Les podcasts, tu en ecoutes ?",
        "La robotique, ça t'interesse ?",
        "Les televiseurs OLED, t'as vu ?",
        "Le cloud, tu utilises ?",
        "Les casques VR, t'as teste ?",
        "Les applications de livraison, tu utilises ?",
        "Les batteries externes, t'as toujours une ?",
        "Les ecrans doubles, t'as teste ?",
        "Les data centers, ça t'interesse ?",
        "Les VPN, t'utilises ?",
        "Les mises a jour, tu les fais tout de suite ?",
        "Les ecrans de telephone, tu les casses souvent ?",
        "Les jeux en ligne, tu joues ?",
        "Les applications de fitness, t'utilises ?",
        "Les videos en 4K, ça change quoi ?",
        "Les e-mails, tu en recois trop ?",
        "Les claviers mecaniques, t'as teste ?",
        "Les innovations ecologiques, tu suis ?",
        "La technologie, c'est plutot une aide ou une dependance ?",
        "Tu as quel type de telephone ?",
        "Tu utilises des applications de sante ?",
        "Tu as un ordinateur portable ou fixe ?",
        "Tu fais des mises a jour ?",
        "Tu utilises le cloud ?",
        "Tu as un appareil connecte ?",
        "Tu regardes des tutoriels ?",
        "Tu as un antivirus ?",
        "Tu achetes en ligne ?",
        "Tu utilises des assistants vocaux ?",
        "Tu as une montre connectee ?",
        "Tu fais des sauvegardes ?",
        "Tu utilises des applications de messagerie ?",
        "Tu as un abonnement streaming ?",
        "Tu fais du tchat video ?",
        "Tu as des jeux video ?",
        "Tu utilises des reseaux sociaux ?",
        "Tu as un casque VR ?",
        "Tu utilises des appareils photo numeriques ?",
        "Tu as une imprimante 3D ?",
        "Tu utilises le paiement mobile ?",
        "Tu as un home cinéma ?",
        "Tu utilises des applications de cartes ?",
        "Tu as un drone ?",
        "Tu utilises des applications de course ?",
        "Tu as un ecran incurve ?",
        "Tu utilises le partage d'ecran ?",
        "Tu as un clavier sans fil ?",
        "Tu utilises des applications de cuisine ?",
        "Tu as un routeur performant ?",
        "Tu utilises des applications de lecture ?",
        "Tu as une enceinte connectee ?",
        "Tu utilises le stockage externe ?",
        "Tu as un PC gamer ?",
        "Tu utilises des applications de medecine ?",
        "Tu as un teleobjectif ?",
        "Tu utilises des services de vidéo a la demande ?",
        "Tu as une batterie externe ?",
        "Tu utilises des applications de banque ?",
        "Tu as un ecran tactile ?",
        "Tu utilises le partage de fichiers ?",
        "Tu as une webcam ?",
        "Tu utilises des applications de fitness ?",
        "Tu as une TV connectee ?",
        "Tu utilises des applications de musique ?",
        "Tu as un disque dur externe ?",
        "Tu utilises des applications de notes ?",
        "Tu as un chargeur sans fil ?",
        "Tu utilises des applications de transport ?",
        "Tu as un bracelet connecte ?"
    };
    std::string reponsesTech[100] = {
        "Un iPhone, je suis reste chez Apple.",
        "Trop, surement 4 ou 5 heures par jour.",
        "Oui, Instagram et TikTok surtout.",
        "Pas grand-chose, j'appelle un pote quand ça plante.",
        "Un peu, surtout pour les emplois.",
        "Oui, je joue a des jeux de sport.",
        "Netflix et Disney+, je regarde tout.",
        "Non, je trouve ça inutile.",
        "Peut-etre un jour, mais pas tout de suite.",
        "Une fois, c'est marrant mais complique.",
        "Oui, mais je vois pas la difference.",
        "Dans le cloud, comme tout le monde.",
        "Alexa a la maison, pour la musique.",
        "Portable, je peux le trimballer.",
        "Netflix, Spotify, et un peu de stockage.",
        "Oui, Tinder, j'ai eu des droles d'histoires.",
        "Oui, Teams et Zoom, c'est devenu indispensable.",
        "Oui, une petite enceinte bluetooth.",
        "Non, j'aime trop le papier.",
        "Pas trop, je prefere le monde reel.",
        "Un peu, du Bitcoin pour tester.",
        "Oui, c'est style mais trop cher.",
        "Oui, c'est intuitif.",
        "Trop, je scroll sans reflechir.",
        "Oui, j'utilise des mots de passe differents.",
        "Un peu, je lis des articles.",
        "Non, c'est trop cher pour moi.",
        "Des ampoules connectees, rien de plus.",
        "Oui, je fais attention aux mails bizarres.",
        "Oui, une montre pour mes pas.",
        "Oui, pour lire et regarder des series.",
        "Oui, en voiture ou en marchant.",
        "Oui, les robots qui aident les gens.",
        "Oui, l'image est magnifique.",
        "Google Drive, c'est ma bouee de sauvetage.",
        "Une fois, j'ai eu le mal de mer.",
        "Uber Eats, une fois par semaine.",
        "Oui, le telephone decharge vite.",
        "Oui, c'est super pour le travail.",
        "Pas trop, c'est invisible pour moi.",
        "Oui, pour regarder des series bloquees.",
        "Je les remets a plus tard...",
        "Une fois par an, je suis maladroit.",
        "Un peu, Fortnite avec des potes.",
        "Oui, pour suivre mes seances.",
        "La qualite est incroyable.",
        "Des centaines par jour, c'est infernal.",
        "Oui, le bruit est satisfaisant.",
        "Oui, les panneaux solaires par exemple.",
        "Un peu des deux, difficile de s'en passer.",
        "Un iPhone.",
        "Oui, pour le sommeil.",
        "Un portable.",
        "Oui, automatiques.",
        "Oui, Google Drive.",
        "Oui, une enceinte.",
        "Oui, souvent.",
        "Oui, un antivirus.",
        "Oui, souvent.",
        "Oui, Siri.",
        "Oui, une Apple Watch.",
        "Oui, je sauvegarde.",
        "Oui, WhatsApp.",
        "Oui, Netflix.",
        "Oui, avec la famille.",
        "Oui, sur Switch.",
        "Oui, Instagram.",
        "Non, pas encore.",
        "Oui, un reflex.",
        "Non, c'est cher.",
        "Oui, Apple Pay.",
        "Oui, une TV 4K.",
        "Oui, Google Maps.",
        "Non, pas encore.",
        "Oui, Strava.",
        "Oui, mon ecran est incurve.",
        "Oui, en visio.",
        "Oui, un clavier sans fil.",
        "Oui, Marmiton.",
        "Oui, un bon routeur.",
        "Oui, Kindle.",
        "Oui, une Alexa.",
        "Oui, un SSD externe.",
        "Non, pas un gamer.",
        "Oui, Doctolib.",
        "Oui, pour les photos.",
        "Oui, un abonnement.",
        "Oui, j'en ai une.",
        "Oui, ma banque.",
        "Oui, mon portable.",
        "Oui, par email.",
        "Oui, integree.",
        "Oui, Nike Training.",
        "Oui, une TV Samsung.",
        "Oui, Spotify.",
        "Oui, un disque dur.",
        "Oui, Notes.",
        "Oui, un chargeur sans fil.",
        "Oui, Uber.",
        "Oui, un Fitbit."
    };
    std::string relancesTech[100] = {
        "Tu changes tous les ans ou tu gardes longtemps ?",
        "Tu arrives a reduire ou tu es accro ?",
        "Tu preferes scroller ou poster ?",
        "Tu utilises plutot Mac ou PC ?",
        "Tu utilises des outils IA au quotidien ?",
        "Plutot console ou PC ?",
        "Tu as encore la tele classique ?",
        "Tu connais quelqu'un qui en a une ?",
        "L'autonomie te fait peur ?",
        "Tu en acheterais un ?",
        "Ça change vraiment ta vie ?",
        "Tu as peur de les perdre ?",
        "Tu lui parles comme a une personne ?",
        "Tu preferes la mobilite ou la puissance ?",
        "Ça fait un budget, non ?",
        "T'as trouve l'amour ou juste des galeres ?",
        "Tu preferes le teletravail ou le presentiel ?",
        "Tu l'utilises souvent ?",
        "Mais pour voyager, c'est pratique ?",
        "Tu penses que ça va devenir important ?",
        "Tu as gagne ou perdu ?",
        "Tu en acheterais un ?",
        "Les boutons physiques, ça te manque ?",
        "Tu as des comptes pour le boulot ?",
        "Tu utilises un gestionnaire de mots de passe ?",
        "Une techno qui t'etonne en ce moment ?",
        "Tu imprimerais quoi si t'en avais une ?",
        "La maison autonome, ça te plait ?",
        "T'as deja ete pirate ?",
        "Ça te motive a bouger plus ?",
        "Tu preferes la tablette ou l'ordinateur ?",
        "T'as un podcast a recommander ?",
        "Tu en aurais un a la maison ?",
        "Ça vaut le prix, pour toi ?",
        "Tu as peur de perdre tes donnees ?",
        "Tu t'y remettrais ?",
        "Tu preferes commander ou cuisiner ?",
        "Tu as une marque preferee ?",
        "Tu pourrais revenir en arriere ?",
        "Mais ça consomme beaucoup, non ?",
        "Tu utilises un VPN gratuit ou payant ?",
        "Un jour, t'as eu un bug a cause d'une mise a jour ?",
        "Tu prends une coque renforcee ?",
        "Tu es plutot competitif ou detente ?",
        "Ça te motive ou tu oublies vite ?",
        "Tu as un ecran compatible ?",
        "Tu les classes ou tu les ignores ?",
        "Tu preferes les claviers plats ?",
        "Tu en installerais chez toi ?",
        "Tu pourrais vivre un jour sans ?",
        "Android t'a tente ?",
        "Lesquelles ?",
        "Tu es plutot batterie ou puissance ?",
        "Tu les fais quand ?",
        "Tu stockes quoi ?",
        "Lequel ?",
        "Tu suis quel chaine ?",
        "Il est payant ?",
        "Sur quel site ?",
        "Tu lui parles souvent ?",
        "Elle te sert a quoi ?",
        "Ou ?",
        "Laquelle ?",
        "Lequel ?",
        "Avec qui ?",
        "Quel genre ?",
        "Lequel ?",
        "Tu comptes en acheter un ?",
        "Tu es plutot auto ou manuel ?",
        "Tu l'utilises pour quoi ?",
        "Ca se passe bien ?",
        "Quelle taille ?",
        "Tu t'en sers ou ?",
        "Tu piloterais ?",
        "Laquelle ?",
        "Tu regardes quoi dessus ?",
        "Avec qui ?",
        "Tu tapes vite ?",
        "Quelle recette ?",
        "Il est rapide ?",
        "Laquelle ?",
        "Elle repond bien ?",
        "Il est de quelle taille ?",
        "Tu joues a quoi ?",
        "Quelles applications ?",
        "Quel zoom ?",
        "Quoi en ce moment ?",
        "Elle tient combien de temps ?",
        "Ca t'arrive de douter ?",
        "Tu navigues comment ?",
        "Quels fichiers ?",
        "Elle est en quelle qualite ?",
        "Laquelle ?",
        "Quelle marque ?",
        "Quelles playlists ?",
        "Il est de quelle capacite ?",
        "Tu organises comment ?",
        "Il charge vite ?",
        "Quelle application ?",
        "Il mesure quoi ?"
    };

    // ============ QUIZ QUOTIDIEN : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsQuotidien[50] = {
        "Comment s'est passee ta journee ?",
        "A quelle heure tu te leves en general ?",
        "Tu prends un petit-dejeuner tous les matins ?",
        "Comment tu te rends au travail ?",
        "Tu manges quoi le midi en general ?",
        "Tu fais des courses combien de fois par semaine ?",
        "Tu arrives a ranger ta maison ?",
        "Tu fais la vaisselle tout de suite ou tu attends ?",
        "Tu regardes la tele le soir ?",
        "A quelle heure tu dines en general ?",
        "Tu fais des lessives souvent ?",
        "Les courses en ligne, tu utilises ?",
        "Tu arrives a dormir assez la semaine ?",
        "Tu fais du sport en semaine ?",
        "Tu prends le temps de souffler dans la journee ?",
        "Tu arrives a gerer ton stress au quotidien ?",
        "Tu manges equilibre en semaine ?",
        "Tu passes du temps sur ton telephone le soir ?",
        "Tu as un animal a la maison ?",
        "Ta matinee, elle est plutot calme ou agitee ?",
        "Tu fais ton lit tous les matins ?",
        "Les transports, tu les supportes ?",
        "Tu as des plantes chez toi ?",
        "Tu fais la poussiere souvent ?",
        "Tu prepares tes affaires la veille ?",
        "Tu arrives a ne pas penser au boulot le soir ?",
        "Tu ecoutes de la musique en faisant les taches ?",
        "Le cafe, tu le bois a quel moment ?",
        "Tu as un creneau horaire pour toi ?",
        "Tu mets longtemps a te preparer le matin ?",
        "Tu rentres a quelle heure le soir ?",
        "Tu arrives a eteindre ton telephone la nuit ?",
        "Les repas en famille, c'est important pour toi ?",
        "Tu as une petite astuce pour gagner du temps ?",
        "Tu arrives a lire un peu le soir ?",
        "Les courses de derniere minute, ça t'arrive souvent ?",
        "Tu as un moment ou tu fais le vide ?",
        "Tu prends des nouvelles de tes proches souvent ?",
        "Tu te prepares un gouter le matin ?",
        "Les voisins, tu les connais ?",
        "Tu as des weekends bien remplis ?",
        "Tu as un rituel du dimanche soir ?",
        "La lessive, tu la fais en machine ou a la main ?",
        "Tu perds souvent tes cles ?",
        "Le soir, tu te couches a quelle heure ?",
        "Tu arrives a gerer ton budget au quotidien ?",
        "Les mails, tu les lis le matin ou le soir ?",
        "Tu nettoies ta voiture souvent ?",
        "Tu arrives a garder une routine saine ?",
        "Qu'est-ce qui rend ta journee reussie ?"
    };
    std::string reponsesQuotidien[50] = {
        "Pas trop mal, mais j'ai eu du retard.",
        "7h30, quand le reveil sonne.",
        "Oui, un cafe et des tartines.",
        "En voiture, 20 minutes.",
        "Un plat prepare ou des restes.",
        "Une grande fois le samedi.",
        "Pas tous les jours, mais je fais des efforts.",
        "J'attends, je vais pas mentir.",
        "Oui, une serie ou le journal.",
        "Vers 20h, quand je rentre.",
        "Une fois par semaine, le dimanche.",
        "Oui, c'est plus pratique.",
        "Pas vraiment, je rattrape le weekend.",
        "Deux fois, en sortant du boulot.",
        "Pas assez, je suis toujours presse.",
        "Plus ou moins, ça depend des jours.",
        "J'essaie, mais je craque souvent.",
        "Oui, trop, je scrolle sans fin.",
        "Oui, un chat, c'est mon compagnon.",
        "Agitee, je cours dans tous les sens.",
        "Rarement, je suis trop presse.",
        "Pas trop, c'est bonde en heure de pointe.",
        "Oui, quelques unes, elles tiennent bien.",
        "Une fois par mois, quand ça se voit.",
        "Jamais, je les cherche le matin.",
        "Difficilement, je cogite.",
        "Oui, ça rend tout plus agreable.",
        "Le matin et l'apres-midi.",
        "Le soir apres 22h, quand tout le monde dort.",
        "30 minutes, entre la douche et le petit-dejeuner.",
        "Vers 19h, quand il fait nuit.",
        "Non, il reste toujours allume.",
        "Oui, on essaye de le faire le dimanche.",
        "Preparer mes affaires en rentrant.",
        "J'aimerais, mais je m'endors vite.",
        "Trop souvent, j'oublie toujours un truc.",
        "En prenant une douche, ça me detend.",
        "J'essaie, mais je suis pas regulier.",
        "Oui, un fruit ou un yaourt.",
        "Un peu, on se dit bonjour.",
        "Oui, je vois du monde ou je sors.",
        "Preparer la semaine a venir.",
        "Machine, je suis pas un heros.",
        "Oui, je les cherche tout le temps.",
        "Vers 23h, apres une serie.",
        "Pas facile, mais je fais attention.",
        "Le matin, pour commencer.",
        "Pas assez, c'est un chantier.",
        "J'essaie, mais les imprevus arrivent.",
        "Un bon repas et une soiree tranquille."
    };
    std::string relancesQuotidien[50] = {
        "T'as reussi a faire tout ce que tu voulais ?",
        "Tu appuies sur snooze ou tu te leves direct ?",
        "Si tu sautes le petit-dejeuner, tu tiens la journee ?",
        "Les bouchons, c'est un calvaire ?",
        "Tu cuisines la veille ou tu achetes sur place ?",
        "Tu fais une liste ou tu achetes au hasard ?",
        "Le desordre, ça te stresse ou ça te derange pas ?",
        "Elle s'accumule jusqu'au weekend ?",
        "Tu as un rituel avant de dormir ?",
        "Tu manges devant la tele ou a table ?",
        "Tu repasses ou tu sors les vetements froisses ?",
        "Tu preferes livrer ou aller au supermarche ?",
        "La fatigue, ça se voit sur ta journee ?",
        "Le sport, ça te vide la tete ou ça te fatigue plus ?",
        "Tu as un moment de pause ou tu fais rien ?",
        "Une astuce pour decompresser vite ?",
        "Le weekend, tu te fais plaisir ?",
        "Tu arrives a decrocher ou t'es colle ?",
        "Il te reveille le matin ?",
        "Ce qui te prend le plus de temps ?",
        "Ça change ta journee quand tu le fais ?",
        "Tu preferes conduire ou prendre les transports ?",
        "Tu arrives a les garder en vie ?",
        "Tu aimes faire le menage ou tu detestes ?",
        "Tu perds souvent des trucs ?",
        "Tu as un rituel pour couper ?",
        "Tu mets quoi en fond ?",
        "Le cafe du soir, t'oses ou pas ?",
        "Tu fais quoi dans ce moment ?",
        "Tu es plutot rapide ou tu traines ?",
        "T'as une activite en rentrant ou tu te poses ?",
        "Ça t'arrive de checker en pleine nuit ?",
        "Tu prepares des repas speciaux ?",
        "Une astuce que tu as apprise recemment ?",
        "Tu preferes la lecture ou les series ?",
        "Le plus souvent, tu oublies quoi ?",
        "La douche, c'est plutot rapide ou tu traines ?",
        "Tu preferes les appeler ou textoter ?",
        "Au boulot, tu grignotes a la pause ?",
        "Tu as deja partage un repas avec eux ?",
        "Un weekend tranquille, ça te fait du bien ?",
        "Ça te stresse ou ça t'organise ?",
        "Tu les fais secher dehors ou dans la maison ?",
        "Tu les ranges toujours au meme endroit ?",
        "Le lendemain, tu regrettes de t'etre couche tard ?",
        "T'as une astuce pour economiser ?",
        "Ça te prend combien de temps ?",
        "T'aimes laver la voiture ou tu trouves ça chiant ?",
        "Si ta routine est cassee, tu t'adaptes ?",
        "Une journee parfaite, ça ressemble a quoi ?"
    };

    // ============ QUIZ LOISIRS : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsLoisirs[100] = {
        "Qu'est-ce que tu fais pendant ton temps libre ?",
        "T'as un hobby particulier ?",
        "Tu fais du sport pour le loisir ?",
        "T'aimes jardiner ?",
        "Tu joues a des jeux de societe ?",
        "Tu vas au cinema souvent ?",
        "T'aimes cuisiner pour le plaisir ?",
        "Tu ecoutes de la musique en loisir ?",
        "Tu as une collection quelque chose ?",
        "T'aimes voyager pendant tes loisirs ?",
        "Tu fais du benevolat ?",
        "T'aimes les escape games ?",
        "Tu fais des travaux manuels ?",
        "T'aimes les parcs d'attractions ?",
        "Tu dessines ou tu peins ?",
        "T'aimes la randonnee ?",
        "Tu as un abonnement a une salle de sport ?",
        "T'aimes la peche ?",
        "Tu fais de la meditation ?",
        "T'aimes les jeux video ?",
        "Tu as un podcast prefere ?",
        "T'aimes faire du shopping ?",
        "Tu fais des sorties culturelles ?",
        "T'aimes les soirees jeux de cartes ?",
        "Tu te promenes souvent ?",
        "T'aimes le bricolage creatif ?",
        "T'aimes les sports extremes ?",
        "Tu lis des BD ou des mangas ?",
        "T'aimes le karaoke ?",
        "Tu as un instrument de musique ?",
        "T'aimes les marches en nature ?",
        "Tu fais des puzzles ou des casse-tetes ?",
        "T'aimes aller au restaurant ?",
        "Tu as un abonnement a un magazine ?",
        "T'aimes les activites manuelles ?",
        "Tu regardes des documentaires ?",
        "T'aimes la danse ?",
        "Tu fais de la photographie ?",
        "T'aimes faire la fete ?",
        "Tu as un loisir insolite ?",
        "T'aimes les jeux en famille ?",
        "Tu vas a des festivals ?",
        "T'aimes les sports d'eau ?",
        "Tu bricoles dans ton jardin ?",
        "Tu apprends des langues en loisir ?",
        "T'aimes les chateaux et monuments ?",
        "Tu as un hobby creatif ?",
        "T'aimes les activites nautiques ?",
        "Tu vas au spa ou au hammam ?",
        "Si tu pouvais faire un loisir tous les jours ?",
        "Tu fais de la cuisine le weekend ?",
        "Tu plantes des legumes ?",
        "Tu as un potager ?",
        "Tu fais des balades en foret ?",
        "Tu regardes la nature autour de toi ?",
        "Tu fais du jardinage ?",
        "Tu ramasses des champignons ?",
        "Tu vas a la peche ?",
        "Tu fais du velo en campagne ?",
        "Tu observes les etoiles ?",
        "Tu fais des promenades en bord de mer ?",
        "Tu cueilles des fleurs sauvages ?",
        "Tu fais des pique-niques en plein air ?",
        "Tu as un animal de compagnie ?",
        "Tu fais de l'observation des oiseaux ?",
        "Tu fais des randonnees en montagne ?",
        "Tu cultives des plantes d'interieur ?",
        "Tu fais des sorties en nature avec des amis ?",
        "Tu collects des cailloux ?",
        "Tu fais du camping ?",
        "Tu fais des feux de camp ?",
        "Tu ramasses des coquillages ?",
        "Tu fais du canoë sur une riviere ?",
        "Tu prends soin d'un arbre ?",
        "Tu fais des promenades au parc ?",
        "Tu aimes le grand air ?",
        "Tu fais du jardin en ville ?",
        "Tu regardes des documentaires nature ?",
        "Tu fais des sorties entre amis le dimanche ?",
        "Tu fais des marches rapides ?",
        "Tu es plutot plage ou montagne ?",
        "Tu fais du yoga en plein air ?",
        "Tu as un coin nature prefere ?",
        "Tu fais des photos de paysages ?",
        "Tu cueilles des fruits en saison ?",
        "Tu fais des soirées entre voisins ?",
        "Tu bricoles dans ton garage ?",
        "Tu fais des vide-greniers ?",
        "Tu repeins des meubles ?",
        "Tu collectionnes des objets ?",
        "Tu fais des puzzles ?",
        "Tu jardines sur ton balcon ?",
        "Tu fais des jeux de societe ?",
        "Tu prepares des conserves ?",
        "Tu fais du tricot ou du crochet ?",
        "Tu fais des casse-tetes ?",
        "Tu fais de la poterie ?",
        "Tu fais des courses de relais ?",
        "Tu fais des projets manuels ?",
        "Tu passes du temps au bord d'un lac ?"
    };
    std::string reponsesLoisirs[100] = {
        "Je regarde des series ou je lis.",
        "La photographie, j'adore capturer des moments.",
        "Un peu de course a pied, pour me vider la tete.",
        "Oui, j'ai des plantes sur mon balcon.",
        "Oui, le weekend avec des amis.",
        "Une fois par mois, quand il y a un bon film.",
        "Oui, j'adore tester des recettes nouvelles.",
        "Oui, tout le temps, c'est ma passion.",
        "Des vinyles, je suis un peu collectionneur.",
        "Oui, des que j'ai des conges.",
        "Parfois, dans une association locale.",
        "Oui, c'est super stimulant.",
        "Un peu de bricolage, quand il faut reparer.",
        "Oui, j'adore les sensations.",
        "Je gribouille, rien de serieux.",
        "Oui, surtout en montagne.",
        "Oui, mais j'y vais pas assez.",
        "Non, c'est trop calme pour moi.",
        "Oui, pour me recentrer.",
        "Oui, surtout les jeux de strategie.",
        "Oui, sur l'histoire ou la culture.",
        "Pas trop, je vais a l'essentiel.",
        "Oui, musees et expositions.",
        "Oui, entre potes, c'est toujours sympa.",
        "Oui, le week-end, sans but precis.",
        "Oui, faire des objets deco.",
        "Non, je prefere les sports calmes.",
        "Oui, j'adore les BD d'aventure.",
        "Oui, apres quelques verres surtout.",
        "Une guitare, mais je ne joue plus trop.",
        "Oui, ça ressource.",
        "Oui, ça me detend.",
        "Oui, pour decouvrir des cuisines.",
        "Non, je lis sur internet.",
        "Oui, couture ou tricot.",
        "Oui, surtout animaliers.",
        "Oui, en soiree, juste pour le fun.",
        "Oui, avec mon appareil, en vacances.",
        "Oui, mais pas trop souvent.",
        "La geocaching, une chasse au tresor moderne.",
        "Oui, ça cree des souvenirs.",
        "Oui, musique ou culture.",
        "Oui, le paddle et le kayak.",
        "J'aimerais, mais j'ai pas de jardin.",
        "Oui, l'italien, pour voyager.",
        "Oui, j'adore l'histoire.",
        "Je fais du scrapbooking.",
        "Oui, la voile, c'est genial.",
        "Oui, pour me detendre.",
        "Me balader au bord de la mer.",
        "Oui, j'aime tester des recettes.",
        "Oui, des tomates et des herbes.",
        "Oui, un petit potager.",
        "Oui, presque chaque semaine.",
        "Oui, j'aime observer les saisons.",
        "Oui, ça me detend.",
        "Oui, en automne.",
        "Oui, de temps en temps.",
        "Oui, le long des chemins.",
        "Oui, quand le ciel est degage.",
        "Oui, c'est apaisant.",
        "Oui, au printemps.",
        "Oui, en famille.",
        "Oui, un chien.",
        "Oui, c'est passionnant.",
        "Oui, des que je peux.",
        "Oui, j'ai des plantes vertes.",
        "Oui, c'est plus sympa.",
        "Oui, je ramasse des pierres.",
        "Oui, en ete.",
        "Oui, avec des guimauves.",
        "Oui, sur la plage.",
        "Oui, en descente tranquille.",
        "Oui, un pommier.",
        "Oui, le weekend.",
        "Oui, j'adore.",
        "Oui, en jardiniere.",
        "Oui, la nuit parfois.",
        "Oui, des pique-niques.",
        "Oui, pour le cardio.",
        "Plage, je prefere.",
        "Oui, c'est revigorant.",
        "Oui, une foret pres de chez moi.",
        "Oui, des panoramas.",
        "Oui, des cerises et des pommes.",
        "Oui, des grillades.",
        "Oui, de petits projets.",
        "Oui, je chine des objets.",
        "Oui, je restaure.",
        "Oui, des pieces anciennes.",
        "Oui, des puzzles de 1000 pieces.",
        "Oui, des aromates.",
        "Oui, en famille.",
        "Oui, des tomates.",
        "Oui, des echarpes.",
        "Oui, le dimanche.",
        "Oui, j'essaie des modelages.",
        "Oui, en ete.",
        "Oui, du bricolage.",
        "Oui, c'est mon coin calme."
    };
    std::string relancesLoisirs[100] = {
        "Tu arrives a te poser ou tu bouges tout le temps ?",
        "Tu utilises un appareil pro ou ton telephone ?",
        "Tu fais ça seul ou avec des potes ?",
        "Tu as la main verte ou tu les oublies ?",
        "Lequel est ton prefere ?",
        "Tu preferes le cinema ou regarder a la maison ?",
        "Quelle est ta specialite ?",
        "Tu ecoutes plutot en fond ou tu t'y mets a fond ?",
        "Le plus rare, tu l'as trouve ou ?",
        "Plutot des longs voyages ou des week-ends ?",
        "Quelle cause te tient a coeur ?",
        "T'as deja reussi a sortir sans indice ?",
        "Tu es plutot outillage ou tu improvises ?",
        "Lequel est le mieux selon toi ?",
        "T'as deja essaye d'exposer ?",
        "La plus belle rando que t'as faite ?",
        "Tu preferes la muscu ou les cours collectifs ?",
        "Tu connais des gens qui pechent ?",
        "T'as des techniques ou tu improvises ?",
        "Tu y joues en solo ou en ligne ?",
        "Tu les ecoutes en faisant autre chose ?",
        "Tu preferes les boutiques ou en ligne ?",
        "La derniere expo que t'as vue ?",
        "Tu joues a quoi ? Poker, Uno, autre ?",
        "Tu aimes te promener en ville ou en nature ?",
        "Tu les gardes ou tu les offres ?",
        "Tu connais quelqu'un qui en fait ?",
        "Tu as une collection ou tu les empruntes ?",
        "Ta chanson fetiche au karaoke ?",
        "Tu aimerais reprendre un jour ?",
        "Le plus bel endroit ou t'es alle ?",
        "Tu preferes les puzzles ou les jeux de logique ?",
        "Type de cuisine prefere ?",
        "Un site ou une revue que tu consultes souvent ?",
        "Tu fais des trucs utiles ou juste pour le plaisir ?",
        "Tu as un docu a conseiller ?",
        "Tu as pris des cours ou tu improvises ?",
        "Tu preferes les portraits ou les paysages ?",
        "Tu preferes les grosses soirees ou les petits trucs ?",
        "Comment ça marche ?",
        "Lequel est le plus drole ?",
        "Le meilleur festival que t'as fait ?",
        "T'as deja fait du surf ?",
        "Tu jardinerais en appartement ?",
        "Tu pratiques avec des applis ou des cours ?",
        "Le plus beau que t'as visite ?",
        "Tu en offres ou tu gardes tout ?",
        "Tu as deja navigue longtemps ?",
        "Plutot soins ou detente totale ?",
        "Ça te manque quand tu peux pas ?",
        "Quelle recette en ce moment ?",
        "Quels legumes ?",
        "Il est grand ?",
        "Quelle foret ?",
        "Qu'est-ce que tu remarques ?",
        "Tu fais quoi comme travaux ?",
        "Tu sais les identifier ?",
        "Tu manges ta peche ?",
        "Tu passes par quels chemins ?",
        "Tu connais des constellations ?",
        "Quel coin ?",
        "Tu les mets ou ?",
        "Avec qui ?",
        "Quel animal ?",
        "Quel oiseau ?",
        "Quel sentier ?",
        "Lesquelles ?",
        "Vous allez ou ?",
        "Tu en as combien ?",
        "Tu campes souvent ?",
        "Tu racontes des histoires ?",
        "Tu les gardes ?",
        "C'est sur quelle riviere ?",
        "Tu le plantes quand ?",
        "Quel parc ?",
        "Tu sors souvent ?",
        "Ca donne quoi ?",
        "Sur quel sujet ?",
        "Vous faites quoi ?",
        "Tu marches combien de temps ?",
        "Pourquoi ?",
        "Ca t'apporte quoi ?",
        "Il a un nom ?",
        "Tu les exposes ?",
        "Tu fais des confitures ?",
        "Vous faites quoi ensemble ?",
        "Quel projet ?",
        "Tu trouves quoi ?",
        "Quelle piece ?",
        "C'est quoi ta collection ?",
        "Tu les finis ?",
        "Quelles plantes ?",
        "Lequel ?",
        "Quelle conserve ?",
        "Tu as un projet en cours ?",
        "Tu en fais souvent ?",
        "Tu as pris des cours ?",
        "Avec qui ?",
        "Tu termines souvent ?",
        "Qu'est-ce que tu fais la-bas ?"
    };

    // ============ QUIZ NATURE : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsNature[50] = {
        "T'aimes te promener en nature ?",
        "Tu as un jardin ou un balcon ?",
        "T'as deja vu un animal sauvage en vrai ?",
        "La plage ou la montagne, tu preferes quoi ?",
        "Tu plantes des arbres ou tu t'en fous ?",
        "La meteo, ça influence ton moral ?",
        "T'aimes les animaux ?",
        "Tu fais attention a l'environnement ?",
        "T'as deja dormi a la belle etoile ?",
        "Les fleurs, tu connais leurs noms ?",
        "Tu fais des randonnees souvent ?",
        "Les levers de soleil, tu te leves pour les voir ?",
        "T'as deja vu une eclipse ?",
        "La pollution, ça t'inquiete ?",
        "T'aimes jardiner ?",
        "La neige, t'aimes ?",
        "Tu te baignes en eau naturelle ?",
        "Les oiseaux, tu les observes ?",
        "La foret, tu y vas souvent ?",
        "Le vent, ça t'enerve ou ça te plait ?",
        "Les cascades, t'as deja vu ?",
        "La nature en ville, ça existe pour toi ?",
        "T'as un coin nature prefere ?",
        "Les insectes, t'aimes pas ?",
        "Tu connais des plantes medicinales ?",
        "Tu regardes des documentaires nature ?",
        "La terre, tu la touches souvent ?",
        "Les parcs nationaux, tu visites ?",
        "La chasse, ça te derange ?",
        "Les grosses chaleurs, tu supportes ?",
        "Les rivieres et ruisseaux, t'aimes ?",
        "Tu achetes des produits locaux ?",
        "Les papillons, tu les trouves beaux ?",
        "La nature t'inspire ?",
        "Les orages, ça te fait peur ?",
        "Tu fais attention a l'eau que tu bois ?",
        "Les roches et mineraux, ça t'interesse ?",
        "T'as deja plante un arbre ?",
        "Les quatre saisons, tu aimes toutes ?",
        "La pluie, tu trouves ça poetique ?",
        "Les champignons, tu en cueilles ?",
        "La lumiere du matin, tu l'aimes ?",
        "Les etoiles, tu les regardes ?",
        "Les animaux sauvages, tu les photographies ?",
        "L'ecologie, tu t'y interesses ?",
        "Les sentiers balises, tu suis ?",
        "La terre, elle a une odeur apres la pluie ?",
        "Les falaises, ça t'impressionne ?",
        "Les nuages, tu les observes ?",
        "Si tu pouvais etre un element naturel ?"
    };
    std::string reponsesNature[50] = {
        "Oui, ça me ressource totalement.",
        "Un petit balcon avec des fleurs.",
        "Un cerf une fois, c'etait magique.",
        "La mer, j'adore le bruit des vagues.",
        "J'aimerais, mais j'ai pas la place.",
        "Oui, le soleil me rend heureux.",
        "Oui, surtout les chiens.",
        "Je trie mes dechets, c'est deja ça.",
        "Oui, c'etait incroyable.",
        "Pas trop, je les reconnais quand je vois.",
        "Oui, des que j'ai un weekend libre.",
        "Parfois, quand je suis motive.",
        "Oui, une partielle, c'etait impressionnant.",
        "Oui, je vois la difference en ville.",
        "Oui, ça me detend le dimanche.",
        "Oui, mais pas la gadoue apres.",
        "Oui, dans les lacs ou la mer.",
        "Un peu, il y a des mesanges chez moi.",
        "Oui, pour les balades et les champignons.",
        "J'aime bien, ça donne de la vie.",
        "Oui, une fois en montagne, j'ai adore.",
        "Oui, les parcs et les jardins.",
        "Le bord de mer, calme et apaisant.",
        "Non, les moustiques surtout.",
        "La camomille et la menthe, c'est tout.",
        "Oui, j'adore les documentaires animaliers.",
        "En jardinant, oui, c'est concret.",
        "Oui, j'en fais une priorite en voyage.",
        "Je comprends la regulation, mais j'aime pas.",
        "Pas trop, je cherche l'ombre.",
        "Oui, le bruit de l'eau est relaxant.",
        "Oui, le marche pres de chez moi.",
        "Oui, c'est colore et fragile.",
        "Oui, j'ecris parfois apres une marche.",
        "Un peu, surtout si je suis dehors.",
        "Oui, je bois du robinet.",
        "Pas vraiment, mais je trouve ça joli.",
        "Oui, en colo, c'etait symbolique.",
        "Le printemps, c'est ma preferee.",
        "Oui, quand je suis chez moi.",
        "Non, j'ai trop peur de me tromper.",
        "Elle est douce et doree.",
        "Oui, surtout en montagne.",
        "Oui, j'essaie, c'est pas facile.",
        "Oui, je lis des articles.",
        "Oui, pour pas me perdre.",
        "Oui, j'adore cette odeur.",
        "Oui, la hauteur me stresse un peu.",
        "Oui, j'y vois des formes.",
        "L'eau, pour la fluidite."
    };
    std::string relancesNature[50] = {
        "Tu preferes la foret, la mer ou la montagne ?",
        "Tu arrives a faire pousser des trucs ?",
        "Ou c'etait ?",
        "La montagne pour skier, ça te tente ?",
        "Tu participerais a une operation de reboisement ?",
        "La pluie, ça te deprime ou tu trouves ça doux ?",
        "Tu en as un a la maison ?",
        "Tu as d'autres petits gestes ecolo ?",
        "T'as eu peur des bruits autour ?",
        "Ta fleur preferee ?",
        "La plus belle rando que t'as faite ?",
        "Coucher de soleil, tu preferes ?",
        "Tu voudrais voir une eclipse totale ?",
        "Tu fais des efforts pour limiter ta pollution ?",
        "Tu cultives des legumes ou des fleurs ?",
        "Tu as deja fait un bonhomme de neige ?",
        "Le froid, ça te derange pas ?",
        "Tu as un nichoir dans ton jardin ?",
        "Tu connais les champignons comestibles ?",
        "Le vent fort, ça te fait peur ?",
        "Tu te baignes dedans ?",
        "Tu en profites souvent ?",
        "Le meme coin depuis longtemps ou tu changes ?",
        "Les abeilles, elles t'inquietent ?",
        "Tu en utilises chez toi ?",
        "Lequel t'a le plus marque ?",
        "T'aimes avoir les mains sales ?",
        "Quel est le plus beau pour toi ?",
        "La peche, t'en penses quoi ?",
        "Tu as des astuces pour lutter contre ?",
        "Tu te promenes le long ?",
        "Ça change le gout ?",
        "Tu connais leur cycle de vie ?",
        "Tu ecris des poemes ou des reflexions ?",
        "Mais tu aimes les regarder ?",
        "Tu evites l'eau en bouteille ?",
        "T'as une pierre porte-bonheur ?",
        "Tu es retourne voir sa croissance ?",
        "La moins aimee, c'est quelle saison ?",
        "Et quand tu marches dedans ?",
        "Tu connais quelqu'un qui en cueille ?",
        "Tu preferes la lumiere de fin de journee ?",
        "Tu connais des constellations ?",
        "Le plus bel animal que t'as photographie ?",
        "Tu as un engagement particulier ?",
        "Tu as deja fait un sentier sans balise ?",
        "Tu la reconnais meme les yeux fermes ?",
        "Tu preferes regarder d'en bas ou d'en haut ?",
        "Une forme de nuage qui t'a marque ?",
        "Pourquoi pas le feu ?"
    };

    // ============ QUIZ INTELLIGENCE : questions + reponses + relances ============
    // Comme pour les autres categories, le meme index relie la question,
    // sa reponse et sa relance.
    std::string questionsIntelligence[100] = {
        "La capitale de l'Australie, c'est Sydney ?",
        "Le mont Everest, il fait combien de metres ?",
        "C'est qui le president des Etats-Unis actuellement ?",
        "La Seconde Guerre mondiale, quand elle s'est terminee ?",
        "Qui a peint la Joconde ?",
        "L'eau bout a combien de degres ?",
        "Le plus long fleuve d'Europe, c'est quoi ?",
        "La lune, elle tourne autour de la Terre en combien de temps ?",
        "Le chocolat, il vient d'ou a l'origine ?",
        "C'est quoi le plus petit pays du monde ?",
        "La tour Eiffel, elle a ete construite pour quelle exposition ?",
        "Les dinosaures ont disparu il y a combien de temps ?",
        "Le plus grand ocean du monde ?",
        "Romeo et Juliette, c'est de qui ?",
        "Le Pere Noel, il vient d'ou ?",
        "La langue la plus parlee au monde ?",
        "Le systeme solaire, combien de planetes ?",
        "La premiere femme a avoir vole dans l'espace ?",
        "Le film \"Titanic\", il est sorti quand ?",
        "L'esperance de vie en France, elle est de combien ?",
        "L'Afrique, c'est un pays ou un continent ?",
        "La Grande Muraille de Chine, elle est visible depuis la lune ?",
        "Le loup, il vit ou en France ?",
        "Le premier homme sur la Lune, c'etait en quelle annee ?",
        "Le fromage, combien de varietes en France ?",
        "Le canal de Suez, il relie quoi ?",
        "Les Jeux olympiques antiques, ils viennent d'ou ?",
        "Le kiwi, c'est un fruit ou un oiseau ?",
        "La plus ancienne civilisation, tu sais laquelle ?",
        "Le dopage dans le sport, c'est interdit depuis quand ?",
        "La guerre de Cent Ans, elle a dure combien de temps ?",
        "Le riz, c'est la base alimentaire de quel pays ?",
        "Le premier roman de la litterature francaise ?",
        "L'Amazonie, c'est la plus grande foret ?",
        "Les pyramides d'Egypte, elles ont combien d'annees ?",
        "La photo, ça a ete invente en quelle annee ?",
        "La grippe espagnole, elle a fait combien de morts ?",
        "La plus longue riviere de France ?",
        "Le soleil, il va s'eteindre un jour ?",
        "Le Taj Mahal, c'est un palais ou un mausolee ?",
        "La plus haute cascade du monde ?",
        "Le blues, ça vient d'ou ?",
        "La colonne de la place Vendome, elle commemore quoi ?",
        "La plus grosse planete du systeme solaire ?",
        "Les Gallo-romains, ils vivaient quand ?",
        "La peste noire, elle a tue quel pourcentage de la population ?",
        "La plus vieille universite du monde ?",
        "L'ours polaire, il est menace par quoi ?",
        "Le livre le plus vendu au monde (hors religieux) ?",
        "La culture generale, ça sert a quoi ?",
        "Tu te considères intelligent ?",
        "T'as déjà fait un test de QI ?",
        "Qui est la personne la plus intelligente que tu connaisses ?",
        "L'intelligence, c'est quoi pour toi ?",
        "Tu es plutôt intelligent en maths ou en langues ?",
        "L'intelligence artificielle, ça te fait peur ?",
        "Tu as une mémoire exceptionnelle ?",
        "Être intelligent, ça rend plus heureux ?",
        "Tu préfères la logique ou l'intuition ?",
        "L'école, ça rend plus intelligent ?",
        "Tu as une intelligence pratique ?",
        "Les gens intelligents sont souvent solitaires ?",
        "Est-ce que l'intelligence se transmet ?",
        "Tu as une stratégie pour apprendre vite ?",
        "L'intelligence des animaux, tu l'observes ?",
        "La lecture rend plus intelligent ?",
        "Les jeux de réflexion, tu aimes ?",
        "L'intelligence collective, ça existe ?",
        "Être intelligent, c'est être cultivé ?",
        "L'humour, c'est une forme d'intelligence ?",
        "Tu as un esprit critique ?",
        "Les réseaux sociaux rendent-ils moins intelligent ?",
        "Tu as des intuitions souvent justes ?",
        "L'intelligence, ça peut se perdre avec l'âge ?",
        "Tu aimes les débats intellectuels ?",
        "La musique rend-elle plus intelligent ?",
        "Les enfants sont-ils plus intelligents qu'avant ?",
        "L'intelligence, ça s'évalue avec des diplômes ?",
        "Les voyages rendent-ils plus intelligent ?",
        "L'intelligence artificielle dépasse-t-elle l'humain ?",
        "Tu as un philosophe préféré ?",
        "Les sciences et les arts, lequel est plus intelligent ?",
        "La curiosité, c'est une marque d'intelligence ?",
        "L'intelligence stratégique, tu l'as ?",
        "Les jeux vidéo rendent-ils plus intelligent ?",
        "L'intelligence, c'est un don ou un acquis ?",
        "Les échecs, c'est un sport intellectuel ?",
        "Les algorithmes sont-ils plus intelligents que nous ?",
        "L'intelligence, ça permet d'éviter les erreurs ?",
        "La concentration, c'est une forme d'intelligence ?",
        "Les mères sont-elles plus intelligentes ?",
        "L'intelligence, ça se voit sur le visage ?",
        "Les nouveaux médias abrutissent-ils ?",
        "L'intelligence, ça permet de mieux vivre en société ?",
        "Les tests d'intelligence sont-ils fiables ?",
        "L'intuition, c'est une forme d'intelligence ?",
        "Les débats politiques exigent de l'intelligence ?",
        "L'intelligence, ça demande de l'humilité ?",
        "La capacité d'adaptation, c'est de l'intelligence ?",
        "L'intelligence, c'est la clé du bonheur ?"
    };
    std::string reponsesIntelligence[100] = {
        "Non, c'est Canberra, beaucoup se trompent.",
        "8 848 metres, le plus haut du monde.",
        "Joe Biden, reelu en 2024.",
        "En 1945, avec la capitulation du Japon.",
        "Leonard de Vinci, evidemment.",
        "A 100 degres Celsius, a pression normale.",
        "La Volga, qui traverse la Russie.",
        "Environ 27 jours, le cycle lunaire.",
        "D'Amerique du Sud, des Azteques.",
        "Le Vatican, avec moins de 1 km2.",
        "L'Exposition universelle de 1889.",
        "Environ 65 millions d'annees.",
        "L'ocean Pacifique, sans hesiter.",
        "De Shakespeare, un classique.",
        "D'une legende, mais on dit du pole Nord.",
        "Le mandarin, devant l'anglais.",
        "8, depuis que Pluton a ete declassee.",
        "Valentina Terechkova, en 1963.",
        "En 1997, avec Leonardo DiCaprio.",
        "Environ 83 ans, ça varie.",
        "Un continent, il y a 54 pays.",
        "Non, c'est une legende.",
        "Dans les Alpes et les Pyrenees.",
        "1969, avec Neil Armstrong.",
        "Plus de 400, on est les rois.",
        "La Mediterranee a la mer Rouge.",
        "De la Grece, a Olympie.",
        "Les deux, et aussi un surnom pour les Neo-Zelandais.",
        "La Mesopotamie, ou l'Egypte ancienne.",
        "Officiellement depuis les annees 1960.",
        "116 ans en realite, pas exactement 100.",
        "De l'Asie en general, surtout en Chine.",
        "\"Le Roman de la Rose\", au Moyen Age.",
        "Oui, elle couvre une grande partie de l'Amerique du Sud.",
        "Plus de 4 500 ans, incroyable.",
        "Vers 1826, par Nicephore Niepce.",
        "Environ 50 millions, plus que la guerre.",
        "La Loire, avec plus de 1 000 km.",
        "Oui, dans des milliards d'annees.",
        "Un mausolee, construit par un empereur.",
        "Le Salto Angel, au Venezuela.",
        "Des communautes afro-americaines du sud des Etats-Unis.",
        "La bataille d'Austerlitz, par Napoleon.",
        "Jupiter, la geante.",
        "Entre le 1er et le 5e siecle apres J.-C.",
        "Environ 30 a 60 % en Europe.",
        "Al-Qarawiyyin au Maroc, ou Bologne en Italie.",
        "La fonte des glaces a cause du rechauffement.",
        "\"Don Quichotte\" ou \"Le Petit Prince\".",
        "A comprendre le monde et briller en societe.",
        "Pas spécialement, mais je suis curieux.",
        "Jamais, j'ai peur du résultat.",
        "Mon grand-père, il savait tout.",
        "Savoir résoudre des problèmes.",
        "En langues, c'est plus naturel.",
        "Un peu, surtout pour les emplois.",
        "Pas vraiment, j'oublie souvent.",
        "Pas forcément, ça peut même être lourd.",
        "L'intuition, elle me guide bien.",
        "Oui, mais ça suffit pas.",
        "Oui, je suis bon pour bricoler.",
        "Ça peut arriver.",
        "Oui, en partie par l'éducation.",
        "Je fais des fiches et je répète.",
        "Oui, les dauphins sont fascinants.",
        "Oui, ça ouvre l'esprit.",
        "Oui, les échecs et le sudoku.",
        "Oui, quand on bosse en groupe.",
        "Pas toujours, il y a des ignorants intelligents.",
        "Oui, ça demande de la vivacité.",
        "Oui, je remets tout en question.",
        "Pas forcément, si on les utilise bien.",
        "Oui, mon instinct me sert.",
        "Parfois, mais on gagne en sagesse.",
        "Oui, quand c'est constructif.",
        "Oui, elle développe le cerveau.",
        "Ils sont plus connectés, c'est différent.",
        "Non, il y a des gens très intelligents sans diplômes.",
        "Oui, ça ouvre d'autres horizons.",
        "Dans certains domaines, oui.",
        "Socrate, pour sa méthode.",
        "Les deux se complètent.",
        "Oui, les gens curieux apprennent plus.",
        "Oui, pour planifier.",
        "Certains développent la logique.",
        "Les deux, mais on peut toujours progresser.",
        "Oui, c'est un combat de cerveaux.",
        "Non, ils dépendent de nous.",
        "Pas toujours, on apprend par l'erreur.",
        "Oui, elle permet d'être efficace.",
        "Elles ont une intelligence émotionnelle énorme.",
        "Pas forcément, ça peut se cacher.",
        "Ça dépend de ce qu'on en fait.",
        "Oui, mais l'empathie aussi.",
        "Pas complètement, ils sont limités.",
        "Oui, c'est une intelligence rapide.",
        "Oui, mais aussi de la rhétorique.",
        "Oui, reconnaître qu'on ne sait pas tout.",
        "Oui, c'est essentiel.",
        "Non, le bonheur est autre chose."
    };
    std::string relancesIntelligence[100] = {
        "Et la plus grande ville, tu sais laquelle ?",
        "Le deuxieme plus haut, tu connais ?",
        "Tu sais qui l'a precede ?",
        "Le jour du debarquement, tu te souviens ?",
        "Elle est exposee ou ?",
        "Et elle gele a combien ?",
        "Et le plus long du monde ?",
        "Tu sais pourquoi on dit \"lune rousse\" ?",
        "Le cacao, c'est un fruit ou une plante ?",
        "Et le deuxieme ?",
        "Tu sais qui l'a construite ?",
        "La cause, c'est une meteorite ?",
        "Et le plus petit ?",
        "C'est une tragedie ou une comedie ?",
        "La vraie origine, tu la connais ?",
        "Et en nombre de pays, c'est l'anglais ?",
        "Tu te souviens de l'ordre ?",
        "Et le premier homme ?",
        "Tu sais si le bateau a vraiment coule ?",
        "Et dans le monde, le record ?",
        "Le plus grand pays d'Afrique ?",
        "Tu sais combien elle mesure ?",
        "Tu as peur de lui ?",
        "Sa phrase celebre, tu la connais ?",
        "Ton prefere, c'est lequel ?",
        "C'est en quel pays ?",
        "Ils etaient en l'honneur de quel dieu ?",
        "Tu en as deja mange un ?",
        "Qui a invente l'ecriture ?",
        "Tu connais un cas celebre ?",
        "Entre quels pays ?",
        "Et en Europe, c'est le ble ?",
        "Victor Hugo, c'est quoi son oeuvre celebre ?",
        "Elle produit combien d'oxygene ?",
        "La plus grande, comment s'appelle-t-elle ?",
        "La premiere photo, tu sais ce que c'etait ?",
        "C'etait en quelle annee ?",
        "Et le plus grand fleuve ?",
        "Ça t'angoisse ou tu t'en fous ?",
        "Il est dans quel pays ?",
        "Elle fait combien de metres ?",
        "Et le jazz, c'est lie ?",
        "Tu connais les autres monuments napoleoniens ?",
        "Elle a combien de lunes ?",
        "Un monument gallo-romain en France ?",
        "C'etait une maladie transmise par quoi ?",
        "La Sorbonne, quand elle a ete creee ?",
        "Tu as deja vu un ours polaire ?",
        "Et le plus traduit ?",
        "Tu en apprends tous les jours ?",
        "L'intelligence, c'est inné ou ça se travaille ?",
        "Tu y crois aux tests de QI ?",
        "Qu'est-ce qui le rendait si intelligent ?",
        "Et l'intelligence émotionnelle, t'en penses quoi ?",
        "Et en maths, tu te débrouilles ?",
        "Tu utilises des outils IA au quotidien ?",
        "T'as des techniques pour mieux retenir ?",
        "Pourquoi tu dis ça ?",
        "Et la logique, tu l'utilises quand ?",
        "L'expérience de vie, c'est plus important ?",
        "L'intelligence théorique, tu maîtrises moins ?",
        "Tu connais des gens comme ça ?",
        "Et génétiquement, tu crois ?",
        "Et les methodes visuelles, tu utilises ?",
        "Tu crois qu'ils sont plus intelligents que certains humains ?",
        "Quel livre t'a le plus appris ?",
        "Tu y joues souvent ?",
        "T'as deja vecu une bonne experience ?",
        "Et des cultivés pas très malins ?",
        "T'as un exemple d'humour intelligent ?",
        "Est-ce que ça te rend difficile à vivre ?",
        "Mais le temps qu'on y passe, c'est un problème ?",
        "T'arrives à expliquer pourquoi ?",
        "La sagesse, c'est une forme d'intelligence ?",
        "Tu préfères débattre ou écouter ?",
        "Tu as appris un instrument ?",
        "Ils ont accès à plus d'infos, c'est bien ?",
        "Tu connais des exemples ?",
        "Quel voyage t'as le plus appris ?",
        "Est-ce qu'elle nous remplacera ?",
        "Qu'est-ce qui te plaît chez lui ?",
        "T'es plutôt scientifique ou artiste ?",
        "Tu es curieux de quoi en ce moment ?",
        "T'as une stratégie pour réussir tes projets ?",
        "Tu as un jeu qui t'a appris des choses ?",
        "Tu as progressé dans quoi ?",
        "Tu y joues souvent ?",
        "Tu comprends comment ils fonctionnent ?",
        "Une erreur qui t'a beaucoup appris ?",
        "Tu as des techniques pour te concentrer ?",
        "Tu es d'accord avec ça ?",
        "Tu as déjà été surpris par quelqu'un ?",
        "Tu as une utilisation réfléchie ?",
        "L'empathie, c'est de l'intelligence ?",
        "Tu as un avis sur les tests ?",
        "Tu écoutes souvent ton intuition ?",
        "Tu suis les débats ?",
        "Tu as déjà douté de toi ?",
        "Une situation où tu t'es bien adapté ?",
        "Qu'est-ce qui rend vraiment heureux ?"
    };

    // ============ LIENS CATEGORIE -> QUIZ ============
    // Chaque categorie avec un quiz a ses trois tableaux relies par le meme index.
    std::string* questionsQuiz[14];
    std::string* reponsesQuiz[14];
    std::string* relancesQuiz[14];
    int tailleQuiz[14];             // nombre de triplets (question/reponse/relance) par categorie
    int derniereQuestionQuiz[14];   // question de quiz en attente de reponse (-1 = aucune)
    for (int c = 0; c < 14; c++) {
        questionsQuiz[c] = 0;
        reponsesQuiz[c] = 0;
        relancesQuiz[c] = 0;
        tailleQuiz[c] = 0;
        derniereQuestionQuiz[c] = -1;
    }
    questionsQuiz[0] = questionsSport;
    reponsesQuiz[0] = reponsesSport;
    relancesQuiz[0] = relancesSport;
    tailleQuiz[0] = 100;
    questionsQuiz[1] = questionsNourriture;
    reponsesQuiz[1] = reponsesNourriture;
    relancesQuiz[1] = relancesNourriture;
    tailleQuiz[1] = 100;
    questionsQuiz[2] = questionsVoyage;
    reponsesQuiz[2] = reponsesVoyage;
    relancesQuiz[2] = relancesVoyage;
    tailleQuiz[2] = 100;
    questionsQuiz[3] = questionsMusique;
    reponsesQuiz[3] = reponsesMusique;
    relancesQuiz[3] = relancesMusique;
    tailleQuiz[3] = 100;
    questionsQuiz[4] = questionsCulture;
    reponsesQuiz[4] = reponsesCulture;
    relancesQuiz[4] = relancesCulture;
    tailleQuiz[4] = 100;
    questionsQuiz[5] = questionsTravail;
    reponsesQuiz[5] = reponsesTravail;
    relancesQuiz[5] = relancesTravail;
    tailleQuiz[5] = 100;
    questionsQuiz[6] = questionsSante;
    reponsesQuiz[6] = reponsesSante;
    relancesQuiz[6] = relancesSante;
    tailleQuiz[6] = 100;
    questionsQuiz[7] = questionsPersonnalite;
    reponsesQuiz[7] = reponsesPersonnalite;
    relancesQuiz[7] = relancesPersonnalite;
    tailleQuiz[7] = 100;
    questionsQuiz[8] = questionsLoisirs;
    reponsesQuiz[8] = reponsesLoisirs;
    relancesQuiz[8] = relancesLoisirs;
    tailleQuiz[8] = 100;
    questionsQuiz[9] = questionsIntelligence;
    reponsesQuiz[9] = reponsesIntelligence;
    relancesQuiz[9] = relancesIntelligence;
    tailleQuiz[9] = 100;
    questionsQuiz[10] = questionsTech;
    reponsesQuiz[10] = reponsesTech;
    relancesQuiz[10] = relancesTech;
    tailleQuiz[10] = 100;
    questionsQuiz[11] = questionsQuotidien;
    reponsesQuiz[11] = reponsesQuotidien;
    relancesQuiz[11] = relancesQuotidien;
    tailleQuiz[11] = 50;
    questionsQuiz[12] = questionsNature;
    reponsesQuiz[12] = reponsesNature;
    relancesQuiz[12] = relancesNature;
    tailleQuiz[12] = 50;

    // ============ L'IA INTELLIGENTE COMMENCE LA DISCUSSION ============
    if (mode == 2) {
        // L'IA intelligente ouvre la discussion avec une salutation
        // Premier tour : "te rencontrer" / Retour : "te revoir"
        if (premierTour) {
            std::string ouvertures[] = {
                "Salut " + nom + " ! Ravi de te rencontrer. Raconte-moi ta journée !",
                "Hey " + nom + " ! Enchante. Comment tu vas aujourd'hui ?",
                "Coucou " + nom + " ! Content de te connaitre. Quoi de neuf ?",
                "Wesh " + nom + " ! On se fait connaissance ? Raconte-moi un truc.",
                "Yo " + nom + " ! Comment ca va ? Raconte-moi ta vie.",
                "Ha bonjour " + nom + " ! Je suis curieux de te connaître. Dis-moi tout."
            };
            std::cout << botNom + " : " << ouvertures[prochainIndice(6)] << "\n";
        } else {
            std::string ouvertures[] = {
                "Salut " + nom + " ! Content de te revoir. Tu fais quoi de beau ?",
                "Hey " + nom + " ! Comment tu vas aujourd'hui ?",
                "Coucou " + nom + " ! Quoi de neuf depuis la dernière fois ?",
                "Wesh " + nom + " ! Tu m'avais manque. Raconte !",
                "Yo " + nom + " ! Ça va bien ? Quoi de neuf ?",
                "Ha " + nom + " ! Ravi de te revoir. Dis-moi tout."
            };
            std::cout << botNom + " : " << ouvertures[prochainIndice(6)] << "\n";
        }
        // si on ne connait pas encore son age, on le demande des le depart
        // (la reponse sera reconnue en conversation : "j'ai 25 ans", "25").
        if (age.empty())
            std::cout << botNom + " : Au fait, tu as quel age ?\n";
    }
    // Verifier les anciens rappels au demarrage
    if (!objectifsUtilisateur.empty()) {
        std::cout << botNom + " : Au fait, j'avais quelques rappels pour toi :\n";
        for (unsigned int i = 0; i < objectifsUtilisateur.size() && i < 5; i++) {
            std::cout << botNom + "  * " << objectifsUtilisateur[i] << "\n";
        }
        std::cout << botNom + " : Tu veux qu'on s'en occupe ou je les oublie ?\n";
    }
    // Mode normal (BLAMUNE) : il attend que l'utilisateur commence

    // ============ SAUVEGARDE DE LA MEMOIRE (a tout moment) ============
    // Reecrit memoire.txt depuis ce qui a ete appris sur l'utilisateur. Appele
    // a la sortie MAIS AUSSI apres chaque apprentissage pendant la session : le
    // serveur web tue le processus a l'arret, sinon tout ce qui est appris en
    // ligne (nom, plat, hobby, gout...) serait perdu au redemarrage.
    auto sauvegarderMemoire = [&]() {
        std::string motsSauves = "";
        int compte = 0;
        for (std::map<std::string, int>::iterator it = motsFavoris.begin(); it != motsFavoris.end() && compte < 5; it++) {
            if (it->second > 1) {
                if (compte > 0) motsSauves += ",";
                motsSauves += it->first;
                compte++;
            }
        }
        std::ofstream sauvegarde("memoire.txt", std::ios::binary);
        if (sauvegarde.is_open()) {
            sauvegarde << nom << "\r\n" << plat << "\r\n" << hobby << "\r\n" << motsSauves << "\r\n" << genre
                       << "\r\n" << aime << "\r\n" << aimePas << "\r\n" << age
                       << "\r\n" << metier << "\r\n" << ville << "\r\n" << couleurPreferee
                       << "\r\n" << musiquePreferee << "\r\n" << sportPrefere << "\r\n" << famille
                       << "\r\n" << animalPrefere << "\r\n" << filmPrefere;
            sauvegarde.close();
        }
    };

    while (true) {
        std::cout << "\nToi : ";
        // fin du flux (Ctrl+Z / fichier vide) : on quitte proprement au lieu de tourner en rond
        if (!std::getline(std::cin, phrase)) break;

        std::string p = minuscules(phrase);

        // ============ DETECTER LA CATEGORIE DU SUJET ============
        bool categorieChangee = false;
        int nouvelleCategorie = -1;
        for (int c = 0; c < 14 && nouvelleCategorie < 0; c++) {
            for (int m = 0; m < 30; m++) {
                if (motsCategories[c][m].empty()) break;
                if (phraseContientCle(p, motsCategories[c][m])) {
                    nouvelleCategorie = c;
                    break;
                }
            }
        }
        // mots-cles appris dans les conversations (et partages via savoir.txt)
        if (nouvelleCategorie < 0) {
            for (std::map<std::string, int>::iterator it = motsClesAppris.begin(); it != motsClesAppris.end(); ++it) {
                if (phraseContientCle(p, it->first)) {
                    nouvelleCategorie = it->second;
                    break;
                }
            }
        }
        // seule une categorie 0..12 a un vrai contenu (13 est vide) ; une categorie
        // hors bornes (ex. savoir.txt edite a la main avec "|13") ne doit pas
        // conduire a indexer des tableaux hors limite.
        if (nouvelleCategorie >= 0 && nouvelleCategorie < 13 && nouvelleCategorie != categorieActuelle) {
            categorieActuelle = nouvelleCategorie;
            categorieChangee = true;
        }

        // Formules d'adieu (pas seulement "bye") : on quitte proprement AVANT les
        // connaissances, sinon "au revoir" aboutit sur la reponse floue "devoir".
        {
            bool ditAdieu = (p == "bye");
            if (!ditAdieu) {
                std::string fin = p;
                while (!fin.empty() && (fin[fin.size() - 1] == ' ' || fin[fin.size() - 1] == '?' ||
                                        fin[fin.size() - 1] == '!' || fin[fin.size() - 1] == '.' ||
                                        fin[fin.size() - 1] == ',' || fin[fin.size() - 1] == '\''))
                    fin.erase(fin.size() - 1);
                std::string adieux[] = { "au revoir", "a bientot", "a plus", "a plus tard", "a demain",
                                         "a tout a l'heure", "a la prochaine", "adieu", "bye" };
                for (int i = 0; i < 9 && !ditAdieu; i++) {
                    std::size_t a = adieux[i].size();
                    if (fin.size() >= a && fin.compare(fin.size() - a, a, adieux[i]) == 0) {
                        // le mot de fin doit etre un mot entier (frontiere avant)
                        std::size_t pos = fin.size() - a;
                        bool avant = pos > 0 && ((fin[pos - 1] >= 'a' && fin[pos - 1] <= 'z') || fin[pos - 1] == '\'');
                        if (!avant) ditAdieu = true;
                    }
                }
            }
            if (ditAdieu) break;
        }

        // ============ L'ALPHABET : une seule lettre tapee ============
        // L'IA connait l'alphabet (majuscules et minuscules) : si on lui donne
        // une lettre, elle illustre avec des mots connus qui commencent par elle.
        if (p.size() == 1 && p[0] >= 'a' && p[0] <= 'z') {
            char lettre = p[0];
            std::vector<std::string> motsLettre;
            for (int i = 0; i < 50; i++) {
                if (motsCles[i].empty()) continue;
                std::string norm = sansAccents(motsCles[i]);
                if (!norm.empty() && norm[0] == lettre) motsLettre.push_back(motsCles[i]);
            }
            for (unsigned int i = 0; i < cles.size(); i++) {
                std::string norm = sansAccents(cles[i]);
                if (!norm.empty() && norm[0] == lettre) motsLettre.push_back(cles[i]);
            }
            for (std::map<std::string, int>::iterator it = motsClesAppris.begin(); it != motsClesAppris.end(); ++it) {
                std::string norm = sansAccents(it->first);
                if (!norm.empty() && norm[0] == lettre) motsLettre.push_back(it->first);
            }
            for (std::map<std::string, int>::iterator it = motsObserves.begin(); it != motsObserves.end(); ++it) {
                std::string norm = sansAccents(it->first);
                if (!norm.empty() && norm[0] == lettre && it->second >= 2) motsLettre.push_back(it->first);
            }
            // sans doublon
            std::vector<std::string> uniq;
            for (unsigned int i = 0; i < motsLettre.size(); i++) {
                bool deja = false;
                for (unsigned int j = 0; j < uniq.size() && !deja; j++)
                    if (sansAccents(uniq[j]) == sansAccents(motsLettre[i])) deja = true;
                if (!deja) uniq.push_back(motsLettre[i]);
            }
            // une lettre n'est pas une reponse au quiz en cours
            for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
            derniereQuestionPosee = -1;
            std::string::size_type idx = std::string(alphabet).find(lettre);
            std::string lettreMaj = (idx != std::string::npos)
                ? std::string(1, alphabetMaj[idx]) : std::string(1, lettre);
            if (uniq.empty()) {
                std::cout << botNom + " : " << lettreMaj << " ! Je connais l'alphabet, mais aucun mot ne commence par cette lettre pour l'instant.\n";
            }
            else {
                std::cout << botNom + " : " << lettreMaj << " comme " << uniq[0];
                int affiches = 1;
                for (unsigned int i = 1; i < uniq.size() && affiches < 4; i++) {
                    std::cout << ", " << uniq[i];
                    affiches++;
                }
                std::cout << " !\n";
            }
            dernierSujet = p;
            continue;
        }

        // ============ A : VOCABULAIRE QUI EVOLUE ============
        // Si l'utilisateur emploie souvent le meme mot dans le sujet en cours,
        // ce mot devient un mot-cle de ce sujet (persiste dans savoir.txt).
        bool motPromu = false;
        if (categorieActuelle >= 0 && categorieActuelle < 13) {
            std::string motObs;
            for (unsigned int i = 0; i <= p.size(); i++) {
                char ch = (i < p.size()) ? p[i] : ' ';
                if (ch == ' ' || ch == '?' || ch == '.' || ch == '!' || ch == ',' || ch == ';' || ch == ':') {
                    // on ignore aussi les contractions avec apostrophe ("j'aime", "c'est"...) :
                    // ce ne sont pas de bons mots-cles de sujet.
                    if (!estPetitMot(motObs) && !estMotCourant(motObs)) {
                        bool dejaCle = false;
                        for (int m = 0; m < 30; m++) {
                            if (motsCategories[categorieActuelle][m].empty()) break;
                            if (motsCategories[categorieActuelle][m] == motObs) { dejaCle = true; break; }
                        }
                        if (!dejaCle) {
                            motsObserves[motObs]++;
                            if (motsObserves[motObs] == 3) {
                                int place = -1;
                                for (int m = 0; m < 30; m++) {
                                    if (motsCategories[categorieActuelle][m].empty()) { place = m; break; }
                                }
                                if (place >= 0) {
                                    motsCategories[categorieActuelle][place] = motObs;
                                    bool dejaConnu = false;
                                    for (unsigned int k = 0; k < cles.size(); k++) if (cles[k] == motObs) dejaConnu = true;
                                    if (!dejaConnu) {
                                        enregistrerSavoir(motObs, "Je ne sais pas encore...", categorieActuelle,
                                                         cles, reponses, motsClesAppris);
                                    }
                                    std::cout << botNom + " : Tiens, tu reparles souvent de \"" << motObs
                                              << "\" : je le retiens comme mot-cle du sujet \""
                                              << nomCategories[categorieActuelle] << "\" !\n";
                                    // on arrete la tournee ici : le mot vient d'etre appris,
                                    // il ne doit pas aussitot detourner la conversation.
                                    for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
                                    derniereQuestionPosee = -1;
                                    motPromu = true;
                                    break;
                                }
                            }
                        }
                    }
                    motObs = "";
                }
                else motObs += ch;
            }
        }
        if (motPromu) continue;

        // ============ CHANGER DE MODE EN PLEINE CONVERSATION ============
        // On accepte plusieurs facons de le demander :
        //   "mode", "changer de mode", "change de mode", "mode 1", "mode 2",
        //   "passe en mode 2", "mettre en mode 1", "changer de mode 2", etc.
        bool veutChangerMode =
            p.find("changer de mode") != std::string::npos ||
            p.find("change de mode") != std::string::npos ||
            p.find("changer mode") != std::string::npos ||
            p.find("change mode") != std::string::npos ||
            modeEnToutesLettres(p, '1') ||
            modeEnToutesLettres(p, '2') ||
            p == "mode";
        if (veutChangerMode) {
            int nouveauMode = -1;
            if (modeEnToutesLettres(p, '1')) nouveauMode = 1;
            else if (modeEnToutesLettres(p, '2')) nouveauMode = 2;
            else {
                std::cout << botNom + " : Choisis un mode :\n";
                std::cout << "  1 = IA classique\n";
                std::cout << "  2 = IA humaine\n";
                std::cout << "Ton choix : ";
                std::cin >> nouveauMode;
                std::cin.clear();
    std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');
            }
            if (nouveauMode == 1) {
                mode = 1;
                botNom = "BLAMUNE";
                std::cout << botNom + " : Je redeviens l'IA classique BLAMUNE.\n";
            }
            else if (nouveauMode == 2) {
                mode = 2;
                std::cout << botNom + " : Quel nom veux-tu me donner ? ";
                std::string nouveauNom;
                std::getline(std::cin, nouveauNom);
                if (!nouveauNom.empty()) botNom = nouveauNom;
                std::cout << botNom + " : Mode humain active. Je m'appelle " << botNom << " desormais !\n";
            }
            else
                std::cout << botNom + " : Je ne connais pas ce mode.\n";
            continue;
        }

        // ============ APPRENDRE DE NOUVELLES CONNAISSANCES (savoir.txt) ============
        // "Je t'apprends que ...", "Apprends que ...", "Je veux t'apprendre ..."
        // -> l'IA demande un mot-cle puis la reponse, et l'enregistre dans savoir.txt.
        // Le fichier voyage avec le dossier : si on partage le bot, tout le monde
        // profite des connaissances apprises.
        bool veutApprendre =
            p.find("t'apprendre") != std::string::npos ||
            p.find("t apprendre") != std::string::npos ||
            p.find("t'apprends") != std::string::npos ||
            p.find("t apprends") != std::string::npos ||
            p.find("t'apprendrai") != std::string::npos ||
            p.find("t apprendrai") != std::string::npos ||
            p.find("apprends que") != std::string::npos ||
            p.find("apprends ceci") != std::string::npos ||
            p.find("apprends ca") != std::string::npos ||
            p.find("apprends cela") != std::string::npos ||
            p.find("je t'enseigne") != std::string::npos ||
            p.find("je t enseigne") != std::string::npos;
        if (veutApprendre) {
            std::string cleApprise, repApprise;
            // Essai direct : "je t'apprends que X est Y" (ou "signifie", "veut
            // dire", "c'est"...). On peut tout apprendre d'un coup, sans poser
            // les questions "mot-cle puis reponse" : si le bot attend la
            // reponse et que l'utilisateur envoie autre chose, cette autre
            // phrase etait prise comme mot-cle a la place (et enregistree).
            bool apprisDirect = false;
            std::size_t posQue = p.find("que ");
            if (posQue != std::string::npos) {
                std::size_t posConn = std::string::npos;
                int lenConn = 0;
                const char* connecteurs[] = { " est ", " veut dire ", " signifie ", " c'est ", " c est " };
                const int lConn[] = { 5, 11, 10, 7, 7 };
                for (int cc = 0; cc < 5; cc++) {
                    std::size_t t = p.find(connecteurs[cc], posQue + 4);
                    if (t != std::string::npos && (posConn == std::string::npos || t < posConn)) {
                        posConn = t; lenConn = lConn[cc];
                    }
                }
                if (posConn != std::string::npos) {
                    cleApprise = p.substr(posQue + 4, posConn - posQue - 4);
                    repApprise = p.substr(posConn + lenConn);
                }
            }
            if (!cleApprise.empty()) {
                while (!cleApprise.empty() && cleApprise[0] == ' ') cleApprise.erase(0, 1);
                while (!cleApprise.empty() && cleApprise[cleApprise.size() - 1] == ' ') cleApprise.erase(cleApprise.size() - 1);
                // meme correction que dans extraireDefinition : "que la lune est X"
                // doit apprendre "lune", pas "la lune" (retrouvable plus facilement).
                static const char* articlesDirect[] = { "un ", "une ", "le ", "la ", "les ", "des ", "du ", "de " };
                for (int a = 0; a < 8; a++) {
                    std::size_t la = std::strlen(articlesDirect[a]);
                    if (cleApprise.compare(0, la, articlesDirect[a]) == 0) { cleApprise.erase(0, la); break; }
                }
                while (!cleApprise.empty() && cleApprise[0] == ' ') cleApprise.erase(0, 1);
                while (!repApprise.empty() && repApprise[0] == ' ') repApprise.erase(0, 1);
                while (!repApprise.empty() && repApprise[repApprise.size() - 1] == ' ') repApprise.erase(repApprise.size() - 1);
                if (!repApprise.empty()) apprisDirect = true;
            }
            if (apprisDirect) {
                int catCleDirect = categorieDe(minuscules(cleApprise + " " + repApprise), motsCategories);
                if (enregistrerSavoir(cleApprise, repApprise, catCleDirect, cles, reponses, motsClesAppris)) {
                    std::cout << botNom + " : C'est note ! J'ai appris \"" << cleApprise << "\"";
                    if (catCleDirect >= 0)
                        std::cout << " et je le classe dans le sujet \"" << nomCategories[catCleDirect] << "\"";
                    std::cout << ". On en reparlera. ;)\n";
                    // Partager avec le mode 1 (vocabulaire_partage.txt)
                    enregistrerVocabulairePartage(cleApprise, repApprise, catCleDirect);
                }
                else
                    std::cout << botNom + " : Je connais deja \"" << cleApprise << "\" ! Pas besoin de me le rappeler. ;)\n";
                continue;
            }
            std::cout << botNom + " : Super, j'aime apprendre ! Donne-moi le mot-cle a retenir : ";
            std::getline(std::cin, cleApprise);
            cleApprise = minuscules(cleApprise);
            while (!cleApprise.empty() && cleApprise[0] == ' ') cleApprise.erase(0, 1);
            while (!cleApprise.empty() && cleApprise[cleApprise.size() - 1] == ' ') cleApprise.erase(cleApprise.size() - 1);
            if (cleApprise.empty() || cleApprise == "bye") {
                std::cout << botNom + " : Bon, j'annule alors. Parle-moi d'autre chose !\n";
                continue;
            }
            if (cleApprise.size() < 3) {
                std::cout << botNom + " : Ce mot-cle est trop court pour que je le retienne. Essaye avec un mot plus long !\n";
                continue;
            }
            std::cout << botNom + " : Et quelle est la reponse a associer ? ";
            std::getline(std::cin, repApprise);
            if (repApprise.empty()) repApprise = "Je ne sais pas encore...";
            // on retrouve le sujet associe au mot-cle (s'il y en a un)
            int catCle = categorieDe(minuscules(cleApprise + " " + repApprise), motsCategories);
            if (enregistrerSavoir(cleApprise, repApprise, catCle, cles, reponses, motsClesAppris)) {
                std::cout << botNom + " : C'est note ! J'ai appris \"" << cleApprise << "\"";
                if (catCle >= 0)
                    std::cout << " et je le classe dans le sujet \"" << nomCategories[catCle] << "\"";
                std::cout << ". On en reparlera. ;)\n";
                // Partager avec le mode 1
                enregistrerVocabulairePartage(cleApprise, repApprise, catCle);
            }
            else
                std::cout << botNom + " : Je connais deja \"" << cleApprise << "\" ! Pas besoin de me le rappeler. ;)\n";
            continue;
        }

        // ============ B : APPRENDRE PAR CORRECTION (savoir.txt) ============
        // "non, c'est pas ca, tokyo c'est la capitale du japon" -> on remplace
        // l'ancienne definition de "tokyo" par la nouvelle. Si le mot n'est pas
        // encore connu, on l'apprend comme une nouvelle connaissance.
        if (p.find('?') == std::string::npos) {
            std::string reste = p;
            if (retirerCorrection(reste) && !reste.empty()) {
                std::string cleCorr, defCorr;
                if (extraireDefinition(reste, cleCorr, defCorr)) {
                    bool trouve = false;
                    for (unsigned int i = 0; i < cles.size(); i++) {
                        if (cles[i] == cleCorr) {
                            trouve = true;
                            if (reponses[i] != defCorr) {
                                reponses[i] = defCorr;
                                sauvegarderSavoir(cles, reponses, motsClesAppris);
                                std::cout << botNom + " : Ah, j'avais mal compris ! Je retiens que \""
                                          << cleCorr << "\" " << defCorr << ".\n";
                            }
                            else {
                                std::cout << botNom + " : C'est ce que je disais, on est d'accord !\n";
                            }
                            break;
                        }
                    }
                    if (trouve) {
                        derniereQuestionPosee = -1;
                        for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
                        dernierSujet = p;
                        continue;
                    }
                    int catCle = categorieDe(reste, motsCategories);
                    if (enregistrerSavoir(cleCorr, defCorr, catCle, cles, reponses, motsClesAppris)) {
                        std::cout << botNom + " : Ah, je viens d'apprendre que \"" << cleCorr << "\" "
                                  << defCorr << " !\n";
                        derniereQuestionPosee = -1;
                        for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
                        dernierSujet = p;
                        continue;
                    }
                }
            }
        }

        // ============ APPRENDRE TOUT SEUL (sans dire "j'apprends") ============
        // Si l'utilisateur donne une definition ("tokyo c'est la capitale du japon",
        // "paris est la capitale de la france"...), le bot la retient tout seul
        // et l'enregistre dans savoir.txt. Un mot-cle ne s'apprend qu'une fois.
        bool questionEnAttente = derniereQuestionPosee >= 0;
        if (!questionEnAttente && categorieActuelle >= 0 &&
            questionsQuiz[categorieActuelle] != 0 &&
            derniereQuestionQuiz[categorieActuelle] >= 0) questionEnAttente = true;
        if (!questionEnAttente && p.find('?') == std::string::npos) {
            std::string cleAuto, defAuto;
            if (extraireDefinition(p, cleAuto, defAuto)) {
                // deja connue ? on peut quand meme remplacer une reponse vide apprise toute seule
                int iDeja = -1;
                for (unsigned int i = 0; i < cles.size() && iDeja < 0; i++) {
                    if (cles[i] == cleAuto) iDeja = (int)i;
                }
                if (iDeja >= 0) {
                    if (reponses[iDeja] == "Je ne sais pas encore...") {
                        reponses[iDeja] = defAuto;
                        sauvegarderSavoir(cles, reponses, motsClesAppris);
                        std::cout << botNom + " : Ah, maintenant je sais ! \"" << cleAuto << "\" " << defAuto << ".\n";
                    }
                    else {
                        std::cout << botNom + " : Je connais deja \"" << cleAuto << "\" !\n";
                    }
                    sujetQuestionne = "";
                    dernierSujet = p;
                    continue;
                }
                // Un mot tres proche est deja connu ? C'est une faute d'orthographe :
                // on repond avec la definition deja apprise au lieu d'en apprendre un doublon.
                int iProche = -1;
                for (unsigned int i = 0; i < cles.size() && iProche < 0; i++) {
                    if (motsProches(cleAuto, cles[i])) iProche = (int)i;
                }
                if (iProche >= 0) {
                    std::cout << botNom + " : Ah, tu veux dire \"" << cles[iProche]
                              << "\" ? " << reponses[iProche] << "\n";
                    if (!sujetQuestionne.empty())
                        std::cout << botNom + " : C'est exactement ce que je te demandais, merci !\n";
                    sujetQuestionne = "";
                    dernierSujet = p;
                    continue;
                }
                int catCle = categorieDe(p, motsCategories);
                if (enregistrerSavoir(cleAuto, defAuto, catCle, cles, reponses, motsClesAppris)) {
                    std::cout << botNom + " : Ah, je viens d'apprendre que \"" << cleAuto << "\" " << defAuto << " !";
                    if (catCle >= 0)
                        std::cout << " Je le classe dans le sujet \"" << nomCategories[catCle] << "\".";
                    std::cout << "\n";
                    // Partager avec le mode 1
                    enregistrerVocabulairePartage(cleAuto, defAuto, catCle);
                }
                if (!sujetQuestionne.empty() &&
                    (sujetQuestionne.find(cleAuto) != std::string::npos ||
                     cleAuto.find(sujetQuestionne) != std::string::npos)) {
                    std::cout << botNom + " : C'est exactement ce que je te demandais, merci !\n";
                }
                sujetQuestionne = "";
                dernierSujet = p;
                continue;
            }
            // PATTERN SUPPLEMENTAIRE : "le X c'est Y" (sans "est" explicite)
            // Ex: "le python c'est un langage", "le foot c'est un sport"
            {
                std::string reste = p;
                std::string cleLe, defLe;
                std::string articles2[] = { "le ", "la ", "les ", "l'" };
                for (int a = 0; a < 4; a++) {
                    std::size_t posArt = reste.find(articles2[a]);
                    if (posArt == 0) {
                        std::string apres = reste.substr(posArt + articles2[a].size());
                        std::size_t posCest = apres.find(" c'est ");
                        if (posCest == std::string::npos) posCest = apres.find(" c est ");
                        if (posCest != std::string::npos && posCest > 1) {
                            cleLe = apres.substr(0, posCest);
                            std::string connec = (apres[posCest + 1] == 'c') ? " c'est " : " c est ";
                            defLe = apres.substr(posCest + connec.size());
                            while (!cleLe.empty() && cleLe[0] == ' ') cleLe.erase(0, 1);
                            while (!cleLe.empty() && cleLe[cleLe.size()-1] == ' ') cleLe.erase(cleLe.size()-1);
                            while (!defLe.empty() && defLe[0] == ' ') defLe.erase(0, 1);
                            while (!defLe.empty() && defLe[defLe.size()-1] == ' ') defLe.erase(defLe.size()-1);
                            break;
                        }
                    }
                }
                if (!cleLe.empty() && !defLe.empty()) {
                    bool dejaConnuLe = false;
                    for (unsigned int i = 0; i < cles.size() && !dejaConnuLe; i++) {
                        if (sansAccents(cles[i]) == sansAccents(cleLe)) dejaConnuLe = true;
                    }
                    if (!dejaConnuLe) {
                        int catCleLe = categorieDe(p, motsCategories);
                        if (enregistrerSavoir(cleLe, defLe, catCleLe, cles, reponses, motsClesAppris)) {
                            std::cout << botNom + " : Ah, je retiens que \"" << cleLe << "\" " << defLe << " !\n";
                            enregistrerVocabulairePartage(cleLe, defLe, catCleLe);
                        }
                        sujetQuestionne = "";
                        dernierSujet = p;
                        continue;
                    }
                }
            }
            // PATTERN SUPPLEMENTAIRE : "je connais X" / "je sais ce que c'est que X"
            {
                std::string connu;
                if (p.find("je connais ") != std::string::npos) {
                    std::size_t pos = p.find("je connais ") + 11;
                    connu = p.substr(pos);
                    while (!connu.empty() && connu[connu.size()-1] == ' ') connu.erase(connu.size()-1);
                }
                if (!connu.empty() && connu.size() >= 3) {
                    bool dejaConnuC = false;
                    for (unsigned int i = 0; i < cles.size() && !dejaConnuC; i++) {
                        if (sansAccents(cles[i]) == sansAccents(connu)) dejaConnuC = true;
                    }
                    if (!dejaConnuC) {
                        std::string defConnu = "L'utilisateur connait ce sujet.";
                        int catCleC = categorieDe(connu, motsCategories);
                        if (enregistrerSavoir(connu, defConnu, catCleC, cles, reponses, motsClesAppris)) {
                            std::cout << botNom + " : Ok, je retiens que tu connais \"" << connu << "\" !\n";
                            enregistrerVocabulairePartage(connu, defConnu, catCleC);
                        }
                        sujetQuestionne = "";
                        dernierSujet = p;
                        continue;
                    }
                }
            }
        }

        // ============ REPONSE A UNE QUESTION GENERALE EN ATTENTE ============
        // Si le bot vient de poser une question generale ("Tu aimes le sport ?",
        // "Tu as bien dormi ?"...), la reponse de l'utilisateur est traitee ICI,
        // avant les observations et les connaissances. Sinon, une reponse qui
        // contient un mot-cle connu ("oui je fais du sport", "j'adore les
        // concerts") serait interceptee par le bloc des connaissances ou par
        // l'observation des "j'aime" : la reponse (et la relance) serait perdue.
        if (derniereQuestionPosee >= 0 &&
            p.find('?') == std::string::npos &&
            !phraseContientCle(p, "et toi") &&
            !(categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0 &&
              derniereQuestionQuiz[categorieActuelle] >= 0)) {
            int q = derniereQuestionPosee;
            derniereQuestionPosee = -1;
            if (mode == 2) {
                // l'IA intelligente reagit a la reponse puis relance ;
                // elle retient aussi la reponse (le "rappelle ce qu'il sait"
                // s'enrichit ainsi egalement en mode 2)
                std::string cle = motsCles[q];
                if (!cle.empty()) {
                    profilReponses[cle] = phrase;
                    sauvegarderProfil(profilReponses);
                }
                std::cout << botNom + " : " << relances[q] << "\n";
            }
            else {
                // BLAMUNE note la reponse puis accuse reception (il n'enchaîne
                // pas sur une autre question tout de suite : on laisse le temps
                // a l'utilisateur de discuter avant la question suivante).
                std::string cle = motsCles[q];
                profilReponses[cle] = phrase;
                sauvegarderProfil(profilReponses);
                std::cout << botNom + " : " << reactionReponse(phrase) << "\n";
            }
            dernierSujet = p;
            continue;
        }

        // ============ MODE INTELLIGENT : observer la personne ============
        if (mode == 2) {
            // si le sujet change, on laisse tomber les questions en attente pour suivre le nouveau sujet
            if (categorieChangee) {
                derniereQuestionPosee = -1;
                for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
            }

            // retenir les 6 dernieres phrases
            historique.push_back(phrase);
            if (historique.size() > 6) historique.erase(historique.begin());

            // compter les mots qu'il utilise (il s'habitue a lui)
            std::string mot;
            for (unsigned int i = 0; i < p.size(); i++) {
                if (p[i] == ' ' || p[i] == '?' || p[i] == '.' || p[i] == '!' || p[i] == ',') {
                    if (!mot.empty() && mot.size() > 3) motsFavoris[mot]++;
                    mot = "";
                }
                else mot += p[i];
            }
            if (!mot.empty() && mot.size() > 3) motsFavoris[mot]++;

            // apprendre des faits sur lui dans la conversation
            std::string nbAge;
            if (p.find("je m'appelle") != std::string::npos) {
                std::size_t pos = p.find("je m'appelle") + 13;
                std::string nouveauNom;
                // on lit la casse d'origine (phrase) et pas la version minuscule (p) :
                // "je m'appelle Paul" doit etre retenu comme "Paul", pas "paul".
                for (unsigned int i = pos; i < phrase.size(); i++) {
                    if (phrase[i] == ' ' || phrase[i] == '.') break;
                    nouveauNom += phrase[i];
                }
                if (!nouveauNom.empty()) {
                    nom = nouveauNom;
                    std::cout << botNom + " : Enchanté, " << nom << " ! On va bien s'entendre.\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // son age : "j'ai 25 ans", "j ai 25 ans", "25 ans" ou juste "25"
            else if (estUnAge(p, nbAge)) {
                age = nbAge;
                std::cout << botNom + " : Ah, " << age << " ans ! Je m'en souviendrai.\n";
                sauvegarderMemoire();
                continue;
            }
            // declaration sentimentale ("je t'aime", "j't'aime", "je t'aime bien") :
            // on repond avec chaleur SANS enregistrer comme "aime" (ce n'est pas
            // un gout alimentaire). Le "je n'aime pas" est attrape juste apres
            // par le bloc "aime pas" grace au sous-mot "aime pas".
            else if (p.find("t'aime") != std::string::npos ||
                     p.find("taime") != std::string::npos) {
                std::string reactions[] = {
                    "Haha, ça me fait trop plaisir ! Moi aussi j'aime bien discuter avec toi.",
                    "C'est gentil, ça me touche franchement. T'es un ami, tu sais ?",
                    "Merci, c'est adorable. Toi aussi t'es quelqu'un de bien.",
                    "Oh là là, ça fait plaisir à entendre ! Continue comme ça.",
                    "C'est mignon ça. Moi aussi j'aime bien nos conversations.",
                    "T'es trop sympa dis donc. Moi aussi j'adore t'écouter.",
                    "Ça me rend heureux de entendre ça. Merci !",
                    "Ok ça me touche. T'es un bon pote, tu sais.",
                    "Haha, t'es adorable. Merci, ça me fait super plaisir.",
                    "C'est trop bien ça. Moi aussi j'aime bien qu'on discute."
                };
                std::cout << botNom + " : " << reactions[prochainIndice(10)] << "\n";
                dernierSujet = p;
                continue;
            }
            // ce qu'il n'aime pas ("je n'aime pas X", "j'aime pas X", "je deteste X")
            else if (p.find("aime pas") != std::string::npos ||
                     p.find("deteste") != std::string::npos) {
                // On cherche le marqueur qui a declenche ("aime pas" ou "deteste")
                // dans la phrase en minuscules, jamais "pas" ou "deteste" ailleurs :
                // l'ancien code prenait le premier "pas" n'importe ou (ex. "c'est
                // pas grave, j'aime pas X" retenait "grave, j'aime pas X") et
                // echouait si "Pas" etait ecrit avec une majuscule.
                std::size_t pos = p.find("aime pas");
                std::size_t debut = 8;   // apres "aime pas"
                if (pos == std::string::npos) {
                    pos = p.find("deteste");
                    debut = 7;           // apres "deteste"
                }
                if (pos == std::string::npos) { continue; }
                std::string chose;
                for (unsigned int i = pos + debut; i < p.size(); i++) {
                    if (p[i] == '.' || p[i] == '!' || p[i] == '?') break;
                    chose += p[i];
                }
                while (!chose.empty() && chose[0] == ' ') chose.erase(0, 1);
                while (!chose.empty() && (chose[0] == ',' || chose[0] == ':')) chose.erase(0, 1);
                // "j'aime pas trop X", "je deteste vraiment X", "j'aime pas du tout X" :
                // seul X compte, pas le degre d'intensite.
                if (chose.compare(0, 4, "trop") == 0 && (chose.size() == 4 || chose[4] == ' ')) chose.erase(0, 4);
                if (chose.compare(0, 8, "vraiment") == 0 && (chose.size() == 8 || chose[8] == ' ')) chose.erase(0, 8);
                if (chose.compare(0, 7, "du tout") == 0 && (chose.size() == 7 || chose[7] == ' ')) chose.erase(0, 7);
                while (!chose.empty() && chose[0] == ' ') chose.erase(0, 1);
                while (!chose.empty() && chose[chose.size() - 1] == ' ') chose.erase(chose.size() - 1);
                if (!chose.empty()) {
                    aimePas = chose;
                    std::cout << botNom + " : Ah, tu n'aimes pas " << aimePas << " ? C'est note !\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // son passe-temps ("mon passe-temps c'est X", "mon hobby c'est X")
            else if (p.find("passe-temps") != std::string::npos || p.find("passe temps") != std::string::npos ||
                     p.find("hobby") != std::string::npos) {
                std::size_t pos = phrase.find("c'est");
                if (pos == std::string::npos) pos = phrase.find("c est");
                if (pos == std::string::npos) { continue; }
                std::string chose;
                for (unsigned int i = pos + 5; i < phrase.size(); i++) {
                    if (phrase[i] == '.' || phrase[i] == '!' || phrase[i] == '?') break;
                    chose += phrase[i];
                }
                while (!chose.empty() && chose[0] == ' ') chose.erase(0, 1);
                while (!chose.empty() && (chose[0] == ' ' || chose[0] == ',' || chose[0] == ':')) chose.erase(0, 1);
                while (!chose.empty() && chose[chose.size() - 1] == ' ') chose.erase(chose.size() - 1);
                if (!chose.empty()) {
                    hobby = chose;
                    std::cout << botNom + " : " << hobby << " comme passe-temps, j'adore ca aussi !\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // --- NOUVEAUX APPRENTISSAGES ---
            // metier / profession : "je suis developpeur", "je travaille comme medecin", "mon metier c'est"
            else if (p.find("je suis") != std::string::npos || p.find("je travaille") != std::string::npos ||
                     p.find("mon metier") != std::string::npos || p.find("ma profession") != std::string::npos ||
                     p.find("mon boulot") != std::string::npos || p.find("je fais comme") != std::string::npos) {
                std::string marqueurs[] = {"je suis ", "je travaille comme ", "mon metier c'est ", "ma profession c'est ", "mon boulot c'est ", "je fais comme "};
                std::string trouve = "";
                for (int i = 0; i < 6 && trouve.empty(); i++) {
                    std::size_t pos = p.find(marqueurs[i]);
                    if (pos != std::string::npos) {
                        pos += marqueurs[i].size();
                        for (unsigned int j = pos; j < p.size(); j++) {
                            if (p[j] == '.' || p[j] == '!' || p[j] == '?' || p[j] == ',') break;
                            trouve += p[j];
                        }
                    }
                }
                while (!trouve.empty() && trouve[0] == ' ') trouve.erase(0, 1);
                while (!trouve.empty() && (trouve[trouve.size()-1] == ' ' || trouve[trouve.size()-1] == '.')) trouve.erase(trouve.size()-1);
                // On ne retient pas si c'est un adjectif ou une emotion ("je suis fatigue", "je suis content")
                if (!trouve.empty() && trouve.size() > 2 && !estAdjectifOuEmotion(trouve)) {
                    metier = trouve;
                    std::string reponses[] = {
                        "Ah, " + metier + " ! C'est un beau metier ca.", "Cool, " + metier + " ! T'es passionne ?",
                        "Intéressant, " + metier + ". Comment c'est au quotidien ?", "Je retiens, " + metier + ". C'est pas facile ca.",
                        "Ah ouais, " + metier + " ! T'as du courage.", "Nice, " + metier + ". Tu aimes ce que tu fais ?"
                    };
                    std::cout << botNom + " : " << reponses[prochainIndice(6)] << "\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // ville / lieu : "j'habite a Paris", "je vis a Lyon", "je suis de Marseille"
            else if (p.find("j'habite") != std::string::npos || p.find("je vis") != std::string::npos ||
                     p.find("je suis de") != std::string::npos || p.find("ma ville") != std::string::npos ||
                     p.find("je reside") != std::string::npos) {
                std::string marqueurs[] = {"j'habite a ", "j'habite a ", "je vis a ", "je suis de ", "ma ville c'est ", "je reside a "};
                std::string trouve = "";
                for (int i = 0; i < 6 && trouve.empty(); i++) {
                    std::size_t pos = p.find(marqueurs[i]);
                    if (pos != std::string::npos) {
                        pos += marqueurs[i].size();
                        for (unsigned int j = pos; j < p.size(); j++) {
                            if (p[j] == '.' || p[j] == '!' || p[j] == '?' || p[j] == ',') break;
                            trouve += p[j];
                        }
                    }
                }
                while (!trouve.empty() && trouve[0] == ' ') trouve.erase(0, 1);
                while (!trouve.empty() && (trouve[trouve.size()-1] == ' ' || trouve[trouve.size()-1] == '.')) trouve.erase(trouve.size()-1);
                if (!trouve.empty() && trouve.size() > 1) {
                    ville = trouve;
                    std::string reponses[] = {
                        "Ah, " + ville + " ! J'adore cette ville.", "Cool, tu vis a " + ville + " ? C'est sympa la-bas ?",
                        "Nice, " + ville + " ! J'ai entendu que c'etait bien.", "Je retiens, " + ville + ". C'est comment la-bas ?",
                        "Ah ouais, " + ville + " ! T'as de la chance.", "Interessant, " + ville + ". J'aimerais bien y aller."
                    };
                    std::cout << botNom + " : " << reponses[prochainIndice(6)] << "\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // couleur preferee : "ma couleur preferee c'est X", "j'aime le bleu", "mon couleur c'est"
            else if (p.find("couleur") != std::string::npos) {
                std::string marqueurs[] = {"ma couleur preferee c'est ", "mon couleur c'est "};
                std::string trouve = "";
                for (int i = 0; i < 2 && trouve.empty(); i++) {
                    std::size_t pos = p.find(marqueurs[i]);
                    if (pos != std::string::npos) {
                        pos += marqueurs[i].size();
                        for (unsigned int j = pos; j < p.size(); j++) {
                            if (p[j] == '.' || p[j] == '!' || p[j] == '?' || p[j] == ',') break;
                            trouve += p[j];
                        }
                    }
                }
                while (!trouve.empty() && trouve[0] == ' ') trouve.erase(0, 1);
                while (!trouve.empty() && (trouve[trouve.size()-1] == ' ' || trouve[trouve.size()-1] == '.')) trouve.erase(trouve.size()-1);
                // Retirer les articles en tete ("le bleu" -> "bleu")
                if (trouve.compare(0, 3, "le ") == 0) trouve.erase(0, 3);
                if (trouve.compare(0, 3, "la ") == 0) trouve.erase(0, 3);
                if (trouve.compare(0, 4, "les ") == 0) trouve.erase(0, 4);
                if (!trouve.empty() && trouve.size() > 2 && trouve.size() < 15) {
                    couleurPreferee = trouve;
                    std::string reponses[] = {
                        "Le " + couleurPreferee + " ? C'est joli ca !", "Belle couleur, le " + couleurPreferee + " !",
                        "Ah, le " + couleurPreferee + " ! T'as bon gout.", "Nice, le " + couleurPreferee + " !",
                        "Le " + couleurPreferee + ", c'est un classique.", "Cool, le " + couleurPreferee + " !"
                    };
                    std::cout << botNom + " : " << reponses[prochainIndice(6)] << "\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // musique / artiste : "j'ecoute X", "ma musique preferee c'est X", "j'aime la musique"
            else if (p.find("j'ecoute") != std::string::npos || p.find("ma musique") != std::string::npos ||
                     p.find("mon artiste") != std::string::npos || p.find("mon groupe") != std::string::npos) {
                std::string marqueurs[] = {"j'ecoute ", "ma musique preferee c'est ", "mon artiste prefere c'est ", "mon groupe prefere c'est "};
                std::string trouve = "";
                for (int i = 0; i < 4 && trouve.empty(); i++) {
                    std::size_t pos = p.find(marqueurs[i]);
                    if (pos != std::string::npos) {
                        pos += marqueurs[i].size();
                        for (unsigned int j = pos; j < p.size(); j++) {
                            if (p[j] == '.' || p[j] == '!' || p[j] == '?' || p[j] == ',') break;
                            trouve += p[j];
                        }
                    }
                }
                while (!trouve.empty() && trouve[0] == ' ') trouve.erase(0, 1);
                while (!trouve.empty() && (trouve[trouve.size()-1] == ' ' || trouve[trouve.size()-1] == '.')) trouve.erase(trouve.size()-1);
                if (!trouve.empty() && trouve.size() > 1) {
                    musiquePreferee = trouve;
                    std::string reponses[] = {
                        "Ah, " + musiquePreferee + " ! J'adore ca aussi.", "Cool, " + musiquePreferee + " ! T'as bon gout.",
                        "Nice, " + musiquePreferee + " ! C'est bien.", "Je retiens, " + musiquePreferee + ".",
                        "Ah ouais, " + musiquePreferee + " ! C'est pas mal.", "Interessant, " + musiquePreferee + " !"
                    };
                    std::cout << botNom + " : " << reponses[prochainIndice(6)] << "\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // sport prefere : "je fais du foot", "mon sport c'est X", "j'aime le tennis"
            else if (p.find("je fais du") != std::string::npos || p.find("mon sport") != std::string::npos ||
                     p.find("je joue au") != std::string::npos || p.find("je joue a") != std::string::npos) {
                std::string marqueurs[] = {"je fais du ", "mon sport c'est ", "je joue au ", "je joue a "};
                std::string trouve = "";
                for (int i = 0; i < 4 && trouve.empty(); i++) {
                    std::size_t pos = p.find(marqueurs[i]);
                    if (pos != std::string::npos) {
                        pos += marqueurs[i].size();
                        for (unsigned int j = pos; j < p.size(); j++) {
                            if (p[j] == '.' || p[j] == '!' || p[j] == '?' || p[j] == ',') break;
                            trouve += p[j];
                        }
                    }
                }
                while (!trouve.empty() && trouve[0] == ' ') trouve.erase(0, 1);
                while (!trouve.empty() && (trouve[trouve.size()-1] == ' ' || trouve[trouve.size()-1] == '.')) trouve.erase(trouve.size()-1);
                if (!trouve.empty() && trouve.size() > 1) {
                    sportPrefere = trouve;
                    std::string reponses[] = {
                        "Le " + sportPrefere + " ? C'est genial ca !", "Cool, tu fais du " + sportPrefere + " !",
                        "Ah, " + sportPrefere + " ! T'es doue ?", "Je retiens, " + sportPrefere + ". C'est bien pour la sante.",
                        "Ah ouais, " + sportPrefere + " ! T'as de la chance.", "Nice, " + sportPrefere + " ! J'aimerais bien essayer."
                    };
                    std::cout << botNom + " : " << reponses[prochainIndice(6)] << "\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // animal prefere : "j'ai un chien", "mon animal prefere c'est X", "j'aime les chats"
            else if (p.find("j'ai un") != std::string::npos || p.find("j'ai une") != std::string::npos ||
                     p.find("mon animal") != std::string::npos || p.find("j'aime les") != std::string::npos) {
                std::string marqueurs[] = {"j'ai un ", "j'ai une ", "mon animal prefere c'est ", "j'aime les "};
                std::string trouve = "";
                for (int i = 0; i < 4 && trouve.empty(); i++) {
                    std::size_t pos = p.find(marqueurs[i]);
                    if (pos != std::string::npos) {
                        pos += marqueurs[i].size();
                        for (unsigned int j = pos; j < p.size(); j++) {
                            if (p[j] == '.' || p[j] == '!' || p[j] == '?' || p[j] == ',') break;
                            trouve += p[j];
                        }
                    }
                }
                while (!trouve.empty() && trouve[0] == ' ') trouve.erase(0, 1);
                while (!trouve.empty() && (trouve[trouve.size()-1] == ' ' || trouve[trouve.size()-1] == '.')) trouve.erase(trouve.size()-1);
                if (!trouve.empty() && trouve.size() > 2) {
                    animalPrefere = trouve;
                    std::string reponses[] = {
                        "Ah, " + animalPrefere + " ! C'est adorable ca.", "Cool, " + animalPrefere + " ! T'es gentil.",
                        "Nice, " + animalPrefere + " ! J'adore les " + animalPrefere + ".", "Je retiens, " + animalPrefere + ".",
                        "Ah ouais, " + animalPrefere + " ! C'est trop bien.", "Interessant, " + animalPrefere + " !"
                    };
                    std::cout << botNom + " : " << reponses[prochainIndice(6)] << "\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // famille : "j'ai un frere", "j'ai une soeur", "ma famille c'est", "mes parents"
            else if (p.find("j'ai un frere") != std::string::npos || p.find("j'ai une soeur") != std::string::npos ||
                     p.find("ma famille") != std::string::npos || p.find("mes parents") != std::string::npos ||
                     p.find("mon pere") != std::string::npos || p.find("ma mere") != std::string::npos) {
                std::string marqueurs[] = {"j'ai un frere", "j'ai une soeur", "ma famille c'est ", "mes parents sont ", "mon pere est ", "ma mere est "};
                std::string trouve = "";
                for (int i = 0; i < 6 && trouve.empty(); i++) {
                    std::size_t pos = p.find(marqueurs[i]);
                    if (pos != std::string::npos) {
                        if (i < 2) { trouve = marqueurs[i]; }
                        else {
                            pos += marqueurs[i].size();
                            for (unsigned int j = pos; j < p.size(); j++) {
                                if (p[j] == '.' || p[j] == '!' || p[j] == '?' || p[j] == ',') break;
                                trouve += p[j];
                            }
                        }
                    }
                }
                while (!trouve.empty() && trouve[0] == ' ') trouve.erase(0, 1);
                while (!trouve.empty() && (trouve[trouve.size()-1] == ' ' || trouve[trouve.size()-1] == '.')) trouve.erase(trouve.size()-1);
                if (!trouve.empty()) {
                    famille = trouve;
                    std::string reponses[] = {
                        "C'est bien d'avoir de la famille.", "La famille, c'est important ca.",
                        "Cool, " + famille + ". C'est chouette.", "Je retiens, tu as " + famille + ".",
                        "Ah, " + famille + " ! C'est bien.", "Nice, la famille !"
                    };
                    std::cout << botNom + " : " << reponses[prochainIndice(6)] << "\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // film prefere : "mon film prefere c'est X", "j'adore le film X", "j'aime le cinema"
            else if (p.find("mon film") != std::string::npos || p.find("j'adore le film") != std::string::npos ||
                     p.find("j'aime le cinema") != std::string::npos || p.find("ma serie") != std::string::npos) {
                std::string marqueurs[] = {"mon film prefere c'est ", "j'adore le film ", "ma serie preferee c'est ", "j'aime le cinema "};
                std::string trouve = "";
                for (int i = 0; i < 4 && trouve.empty(); i++) {
                    std::size_t pos = p.find(marqueurs[i]);
                    if (pos != std::string::npos) {
                        pos += marqueurs[i].size();
                        for (unsigned int j = pos; j < p.size(); j++) {
                            if (p[j] == '.' || p[j] == '!' || p[j] == '?' || p[j] == ',') break;
                            trouve += p[j];
                        }
                    }
                }
                while (!trouve.empty() && trouve[0] == ' ') trouve.erase(0, 1);
                while (!trouve.empty() && (trouve[trouve.size()-1] == ' ' || trouve[trouve.size()-1] == '.')) trouve.erase(trouve.size()-1);
                if (!trouve.empty() && trouve.size() > 1) {
                    filmPrefere = trouve;
                    std::string reponses[] = {
                        "Ah, " + filmPrefere + " ! C'est bien ca.", "Cool, " + filmPrefere + " ! T'as bon gout.",
                        "Nice, " + filmPrefere + " ! C'est un classique.", "Je retiens, " + filmPrefere + ".",
                        "Ah ouais, " + filmPrefere + " ! J'adore ca.", "Interessant, " + filmPrefere + " !"
                    };
                    std::cout << botNom + " : " << reponses[prochainIndice(6)] << "\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
            // ce qu'il aime ("j'aime X", "mon plat prefere c'est X") : on ne garde
            // un plat prefere que si la phrase parle reellement de nourriture,
            // sinon "j'aime le tennis" serait retenu comme un plat.
            else if (p.find("mon plat prefere") != std::string::npos || p.find("j'aime") != std::string::npos) {
                std::size_t pos = phrase.find("c'est");
                if (pos != std::string::npos) pos += 5;
                else {
                    pos = phrase.find("c est");
                    if (pos != std::string::npos) pos += 5;
                }
                if (pos == std::string::npos) {
                    pos = phrase.find("aime");
                    if (pos != std::string::npos) pos += 4;
                }
                if (pos == std::string::npos) pos = 0;
                std::string chose;
                for (unsigned int i = pos; i < phrase.size(); i++) {
                    if (phrase[i] == '.' || phrase[i] == '!') break;
                    chose += phrase[i];
                }
                while (!chose.empty() && chose[0] == ' ') chose.erase(0, 1);
                while (!chose.empty() && chose[chose.size() - 1] == ' ') chose.erase(chose.size() - 1);
                if (!chose.empty()) {
                    bool parleDeNourriture = p.find("mon plat prefere") != std::string::npos ||
                                             contientMot(p, "manger") || contientMot(p, "mange") ||
                                             contientMot(p, "mangent") || contientMot(p, "mangeons") ||
                                             contientMot(p, "mangeais") || contientMot(p, "nourriture") ||
                                             contientMot(p, "repas") || contientMot(p, "cuisine") ||
                                             contientMot(p, "gouter") || contientMot(p, "gout") ||
                                             contientMot(p, "boire") || contientMot(p, "boisson");
                    aime = chose;
                    if (parleDeNourriture) plat = chose;
                    std::cout << botNom + " : Ah, tu aimes " << chose << " ? J'adore ca aussi !\n";
                    sauvegarderMemoire();
                    continue;
                }
            }
        }

        // ============ NOUVELLES FEATURES (tous modes) ============
        nbMessagesSession++;

        // --- /prive : mode ephemere ---
        if (p == "/prive" || p == "prive" || p == "mode prive" || p == "mode ephemere") {
            modePrive = !modePrive;
            if (modePrive)
                std::cout << botNom + " : Mode prive active. Je ne retiens plus rien de cette conversation.\n";
            else
                std::cout << botNom + " : Mode prive desactive. Je peux de nouveau m'en souvenir.\n";
            continue;
        }

        // --- Detection de stress / fatigue (tous modes) ---
        {
            int stress = detecterStress(p);
            if (stress >= 2 && !utilisateurConfus) {
                utilisateurConfus = true;
                if (stress >= 3) {
                    std::string respirations[3] = {
                        "Hey, calme-toi. Inspire 4 secondes, expir 6 secondes. Ca va aller.",
                        "Je sens que t'es en colere. Essaie de respirer profondement 3 fois.",
                        "Pause. Ferme les yeux, respire 3 fois lentement. Je suis la."
                    };
                    std::cout << botNom + " : " << respirations[prochainIndice(3)] << "\n";
                } else {
                    std::string fatigue[3] = {
                        "T'as l'air fatigue. Tu veux qu'on parle de quelque chose de plus leger ?",
                        "Je sens que t'es creve. Tu veux qu'on fasse une pause ?",
                        "T'as pas la forme. On peut simplifier, pas de souci."
                    };
                    std::cout << botNom + " : " << fatigue[prochainIndice(3)] << "\n";
                }
                continue;
            } else if (stress == 0) {
                utilisateurConfus = false;
            }
        }

        // --- Detection de contenu mauvais / incorrect / nuisible ---
        // Le bot ne doit PAS encourager les comportements negatifs.
        {
            std::string critique = detecterCritique(p);
            if (!critique.empty()) {
                std::cout << botNom + " : " << reponseCritique(critique, p) << "\n";
                dernierSujet = p;
                continue;
            }
        }

        // --- Reformulation automatique ---
        if (demandeReformulation(p)) {
            std::string reformule;
            if (!derniereReponseBot.empty()) {
                reformule = reformuler(derniereReponseBot);
            } else {
                reformule = "Je vais essayer d'expliquer autrement. En termes simples, ";
                if (!dernierSujet.empty()) reformule += "ce qu'on disait concernait " + dernierSujet + ". ";
                reformule += "Tu veux que je reformule avec un exemple concret ?";
            }
            std::cout << botNom + " : " << reformule << "\n";
            continue;
        }

        // --- Resume de conversation ---
        if (demandeResume(p)) {
            if (historique.empty()) {
                std::cout << botNom + " : On n'a pas encore trop parle cette session ! Pose-moi une question.\n";
            } else {
                std::cout << botNom + " : Voici un resume de notre conversation :\n";
                for (unsigned int i = 0; i < historique.size(); i++) {
                    std::string h = historique[i];
                    if (!h.empty()) { h[0] = (char)std::toupper((unsigned char)h[0]); }
                    std::cout << "  - " << h << "\n";
                }
                if (!objectifsUtilisateur.empty()) {
                    std::cout << botNom + " : Et n'oublie pas, tes objectifs :\n";
                    for (unsigned int i = 0; i < objectifsUtilisateur.size(); i++) {
                        std::cout << "  * " << objectifsUtilisateur[i] << "\n";
                    }
                }
            }
            continue;
        }

        // --- Rappels intelligents ---
        {
            std::string obj;
            if (detecteObjectif(p, obj)) {
                objectifsUtilisateur.push_back(obj);
                sauvegarderRappels(objectifsUtilisateur);
                std::cout << botNom + " : C'est note ! Je te rappellerai : \"" << obj << "\"\n";
                continue;
            }
        }

        // --- Questions creatives (tous les 8 messages, si pas de quiz en cours) ---
        if (nbMessagesSession > 0 && nbMessagesSession % 8 == 0 &&
            (categorieActuelle < 0 || categorieActuelle >= 13 || questionsQuiz[categorieActuelle] == 0)) {
            std::cout << botNom + " : " << questionCreative(dernierSujet) << "\n";
            dernierSujet = p;
            continue;
        }

        // --- Detection d'habitudes (tous les 10 messages) ---
        if (nbMessagesSession > 0 && nbMessagesSession % 10 == 0 && historique.size() >= 4) {
            std::string habitude = detecterHabitudes(historique);
            if (!habitude.empty()) {
                std::string remarques[3] = {
                    "J'ai remarque que tu parles souvent de \"" + habitude + "\". C'est un sujet qui te tient a coeur ?",
                    "Encore \"" + habitude + "\" ! Je vois que c'est un theme recurrent pour toi.",
                    "Tu reviens souvent sur \"" + habitude + "\". Tu veux qu'on approfondisse ?"
                };
                std::cout << botNom + " : " << remarques[prochainIndice(3)] << "\n";
                continue;
            }
        }

        // --- Score de confiance : si le bot ne sait pas, il le dit ---
        // (sera integre dans les blocs de reponse existants via un indicateur)

        // --- Mode prive : pas de memorisation ---
        if (modePrive) {
            // En mode invite ou prive, on ne memorise PAS les faits sur l'utilisateur
            // Mais on garde quand meme l'historique de la session pour la conversation
            historique.push_back(phrase);
            if (historique.size() > 6) historique.erase(historique.begin());
            // On saute les blocs de memorisation (aime, hobby, etc.)
        }

        // ============ COMPRENDRE LA PHRASE : ETATS, OPINIONS, CONTEXTE ============
        // On lit d'abord ce que ressent ou pense l'utilisateur, avant de repondre
        // avec les connaissances : "j'ai peur" est un etat, pas une demande de
        // definition de "peur". On ne coupe pas la parole quand une question vient
        // d'etre posee (on attend sa reponse).
        {
            bool attente = derniereQuestionPosee >= 0;
            for (int c = 0; c < 14 && !attente; c++)
                if (categorieActuelle >= 0 && questionsQuiz[c] != 0 && derniereQuestionQuiz[c] >= 0)
                    attente = true;
            if (!attente && phrase.find('?') == std::string::npos) {
                // 1. une emotion ou un etat -> reponse humaine
                std::string etat = detecterEtat(p);
                if (!etat.empty()) {
                    std::cout << botNom + " : " << reactionEtat(etat) << "\n";
                    dernierSujet = p;
                    continue;
                }
                // 2. une opinion ("je pense que X...") -> on rebondit dessus
                if (p.find("je pense que") != std::string::npos ||
                    p.find("je crois que") != std::string::npos ||
                    p.find("a mon avis") != std::string::npos ||
                    p.find("selon moi") != std::string::npos ||
                    p.find("pour moi") != std::string::npos) {
                    std::string opinions[4] = {
                        "Interessant ! Pourquoi tu penses ca ?",
                        "Je vois que tu as reflechi au sujet !",
                        "Hmm, je note ton opinion. Dis-m'en plus !",
                        "J'aime bien les gens qui ont leur avis. Developpe !"
                    };
                    std::cout << botNom + " : " << opinions[prochainIndice(4)] << "\n";
                    dernierSujet = p;
                    continue;
                }
                // 3. il reparle de son passe-temps ou de ce qu'il aime : on le reconnait
                std::string hobbySans = retirerArticle(hobby);
                if (!hobbySans.empty() && phraseContientCle(p, hobbySans)) {
                    std::string r[3] = {
                        "Ah, " + hobby + ", ton activite preferee ! J'adore t'en entendre parler.",
                        "Encore " + hobby + " ? Je vois que tu ne t'en lasses pas !",
                        "Ca me rappelle que tu adores " + hobby + " !"
                    };
                    std::cout << botNom + " : " << r[prochainIndice(3)] << "\n";
                    dernierSujet = p;
                    continue;
                }
                // 4. type de phrase : narration, besoin, jugement, etc.
                std::string typePhrase = detecterTypePhrase(p);
                if (!typePhrase.empty()) {
                    std::string reaction = reponseSelonType(typePhrase, p);
                    if (!reaction.empty()) {
                        std::cout << botNom + " : " << reaction << "\n";
                        dernierSujet = p;
                        continue;
                    }
                }
            }
        }

        // ============ REACTIONS SOCIALES EN PRIORITE ============
        // Salutation, politesse ou bien-etre : traites avant les connaissances,
        // sinon la tolerance orthographique les confond avec un mot proche
        // (ex. "bonjour" ~ "bonheur") ou une cle trop courte les avale.
        bool estQuestionDef = p.find('?') != std::string::npos || phraseContientCle(p, "quoi");
        if (phraseContientCleExact(p, "bonjour") || phraseContientCleExact(p, "salut") ||
            phraseContientCleExact(p, "coucou") || phraseContientCleExact(p, "hello") ||
            phraseContientCleExact(p, "hey") || phraseContientCleExact(p, "yo") ||
            phraseContientCleExact(p, "wesh")) {
            dernierSalut = (dernierSalut + 1) % 7;
            int index = dernierSalut;
            std::cout << botNom + " : " << salutations[index] << " " << nom << " ! Comment tu vas ?\n";
            dernierSujet = p;
            continue;
        }
        if (phraseContientCleExact(p, "merci") || phraseContientCleExact(p, "de rien")) {
            std::string r[] = {
                "De rien, c'est normal !", "Avec plaisir, toujours.", "Y'a pas de quoi.",
                "C'est tout naturel.", "Je fais ça avec plaisir.", "Aucun souci.",
                "Toujours là pour toi.", "C'est rien du tout, je t'écoute toujours."
            };
            std::cout << botNom + " : " << r[prochainIndice(8)] << "\n";
            dernierSujet = p;
            continue;
        }
        if (phraseContientCleExact(p, "bonsoir")) {
            std::cout << botNom + " : Bonsoir " << nom << " ! Comment vas-tu ?\n";
            dernierSujet = p;
            continue;
        }
        if (phraseContientCleExact(p, "bonne nuit")) {
            std::cout << botNom + " : Bonne nuit, dors bien !\n";
            dernierSujet = p;
            continue;
        }
        // faim/soif exprimes : on repond chaleureusement, sauf si l'utilisateur
        // en demande une definition ("c'est quoi la faim ?" garde sa reponse).
        if (!estQuestionDef && (phraseContientCleExact(p, "faim") || phraseContientCleExact(p, "soif"))) {
            if (!plat.empty()) std::cout << botNom + " : Tu as deja dit que tu aimais " << plat << "... on en mange ?\n";
            else std::cout << botNom + " : Tu as faim ? Parle-moi de ce que tu aimes manger.\n";
            dernierSujet = p;
            continue;
        }

        // ============ REPONSE AU QUIZ EN COURS (avant les connaissances) ============
        // Si le bot vient de poser une question de quiz, la reponse de l'utilisateur
        // est validee ICI. Sinon, un mot-cle de connaissance (ex. "basket") serait
        // intercepte par le bloc des connaissances et la question resterait sans
        // validation. "et toi" garde son comportement dedie (relance du quiz).
        if (p.find('?') == std::string::npos && !phraseContientCle(p, "et toi") &&
            categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0 &&
            derniereQuestionQuiz[categorieActuelle] >= 0) {
            int c = categorieActuelle;
            int q = derniereQuestionQuiz[c];
            derniereQuestionQuiz[c] = -1;
            if (demandeLaReponse(p)) {
                std::cout << botNom + " : Pas de souci ! La bonne reponse : " << reponsesQuiz[c][q] << "\n";
            }
            else if (reponseProche(p, reponsesQuiz[c][q])) {
                std::cout << botNom + " : Exact ! " << reponsesQuiz[c][q] << "\n";
                std::cout << botNom + " : " << relancesQuiz[c][q] << "\n";
            }
            else {
                std::cout << botNom + " : " << reactionReponse(p) << "\n";
                std::cout << botNom + " : Pour moi, c'est : " << reponsesQuiz[c][q] << "\n";
                std::cout << botNom + " : " << relancesQuiz[c][q] << "\n";
            }
            dernierSujet = p;
            continue;
        }

        // ============ QUESTIONS SUR LE BOT (AVANT les connaissances) ============
        // "comment tu t'appelles?", "ton nom?", "qui es-tu?" -> repondre directement
        // sans passer par la lookup des connaissances (sinon "appelles" matche "appeler")
        if (phraseContientCle(p, "ton nom") || phraseContientCle(p, "t'appelles") ||
            phraseContientCle(p, "qui es-tu") || phraseContientCle(p, "qui es tu")) {
            std::string r[] = {
                "Moi c'est " + botNom + " !", "Je m'appelle " + botNom + ", ravi.",
                botNom + ", c'est moi !", "Moi ? " + botNom + ".",
                "Je suis " + botNom + ", ton pote virtuel."
            };
            std::cout << botNom + " : " << r[prochainIndice(5)] << "\n";
            dernierSujet = p;
            continue;
        }

            // ============ CONNAISSANCES PARTAGEES (les deux modes) ============
        bool connu = false;
        // Ne pas repondre avec une connaissance connue si l'utilisateur pose une
        // question factuelle ("quel est le sens de X", "c'est quoi Y") : il demande
        // une definition, pas qu'on rebondisse sur un mot-cle occurrence.
        if (!estQuestionFactuelle(p)) {
        std::vector<std::string> choix;
        std::size_t meilleureTaille = 0;
        int meilleurChoix = 0;
        bool meilleurExact = false;
        for (unsigned int i = 0; i < cles.size(); i++) {
            if (phraseContientCle(p, cles[i])) {
                // Le mot est-il present en toutes lettres ? A taille egale, un
                // match exact gagne sur un match flou (ex. "nager" doit etre
                // prefere a "gager", proche orthographiquement).
                bool exact = phraseContientCleExact(p, cles[i]);
                // si plusieurs cles correspondent, on garde la plus longue (la plus precise) :
                // ex. "course" est contenu dans "courses", il faut repondre "courses" d'abord.
                if (cles[i].size() > meilleureTaille ||
                    (cles[i].size() == meilleureTaille && exact && !meilleurExact)) {
                    meilleureTaille = cles[i].size();
                    meilleurChoix = (int)choix.size();
                    meilleurExact = exact;
                }
                choix.push_back(reponses[i]);
                connu = true;
            }
        }
        if (connu) {
            int index = meilleurChoix;
            if (choix.size() > 1 && choix[index] == derniereRep) index = (index + 1) % choix.size();
            derniereRep = choix[index];
            // l'utilisateur pose/reprend un sujet de discussion : ce n'est pas une
            // reponse au quiz en cours, on l'abandonne pour ne pas "coincer" le quiz.
            for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
            std::cout << botNom + " : " << choix[index] << "\n";
            dernierSujet = p;
            continue;
        }
        } // fin if (!estQuestionFactuelle)

        // ============ C : "C'EST QUOI X ?" -> ON DEMANDE LA DEFINITION ============
        // Si l'utilisateur demande ce qu'est un mot inconnu, on l'invite a expliquer ;
        // la definition donnee juste apres sera apprise (voir apprentissage auto).
        {
            std::string sujet = extraireSujetQuestion(p);
            if (!sujet.empty()) {
                // deja connu ? on donne la definition apprise
                bool dejaConnu = false;
                std::string defConnu;
                for (unsigned int i = 0; i < cles.size() && !dejaConnu; i++) {
                    if (phraseContientCle(p, cles[i])) {
                        dejaConnu = true;
                        defConnu = reponses[i];
                    }
                }
                if (dejaConnu && !defConnu.empty()) {
                    std::cout << botNom + " : " << defConnu << "\n";
                    dernierSujet = p;
                    continue;
                }
                if (!dejaConnu) {
                    sujetQuestionne = sujet;
                    derniereQuestionPosee = -1;
                    for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
                    std::cout << botNom + " : Bonne question ! Je ne connais pas encore \"" << sujet
                              << "\". Explique-le-moi, je le retiendrai !\n";
                    dernierSujet = p;
                    continue;
                }
            }
        }

        // ============ REGLES DE BASE ============
        if (phraseContientCleExact(p, "ca va")) {
            std::string r[] = {
                "Ça va bien, merci ! Et toi ?", "Tout roule, et toi comment tu vas ?",
                "Nickel, ça va. Et toi ?", "Ça va, tranquille. Et toi comment tu vas ?",
                "Pas mal du tout, merci de demander ! Et toi ?", "Super bien ! Et toi ?"
            };
            std::cout << botNom + " : " << r[prochainIndice(6)] << "\n";
            continue;
        }
        else if (phraseContientCle(p, "comment") && phraseContientCle(p, "vas")) {
            std::string etats[] = {
                "Je vais bien, merci ! Et toi", "Super, tout va bien ! Et toi",
                "Pas mal, et toi", "Tranquille, ça va. Et toi",
                "Nickel, ça va ! Et toi", "Ah bah ça va, et toi comment ?"
            };
            std::cout << botNom + " : " << etats[prochainIndice(6)] << " " << nom << " ?\n";
            continue;
        }
        else if (phraseContientCle(p, "ton nom") || phraseContientCle(p, "tu t'appelles") ||
                 phraseContientCle(p, "qui es-tu") || phraseContientCle(p, "qui es tu")) {
            std::string r[] = {
                "Moi c'est " + botNom + " !", "Je m'appelle " + botNom + ", ravi.",
                botNom + ", c'est moi !", "Moi ? " + botNom + ".",
                "Je suis " + botNom + ", ton pote virtuel."
            };
            std::cout << botNom + " : " << r[prochainIndice(5)] << "\n";
            continue;
        }
        else if (phraseContientCle(p, "et toi")) {
            // "et toi" ne veut pas dire "comment tu t'appelles" : on lit la phrase
            // et on repond a ce qui vient d'etre dit ou pose.
            bool repondu = false;
            // 1. Une reponse dans les connaissances partagees
            for (unsigned int i = 0; i < cles.size() && !repondu; i++) {
                if (phraseContientCle(p, cles[i])) {
                    std::cout << botNom + " : " << reponses[i] << "\n";
                    repondu = true;
                }
            }
            // 2. Une question generale qui vient d'etre posee
            if (!repondu && derniereQuestionPosee >= 0) {
                std::cout << botNom + " : " << reponsesIA[derniereQuestionPosee] << "\n";
                derniereQuestionPosee = -1;
                repondu = true;
            }
            // 3. Une question de quiz en attente : bonne reponse puis relance
            if (!repondu && categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0 &&
                derniereQuestionQuiz[categorieActuelle] >= 0) {
                int c = categorieActuelle;
                int q = derniereQuestionQuiz[c];
                derniereQuestionQuiz[c] = -1;
                std::cout << botNom + " : " << reponsesQuiz[c][q] << "\n";
                std::cout << botNom + " : " << relancesQuiz[c][q] << "\n";
                repondu = true;
            }
            // 3bis. On repond avec ce qu'on sait sur lui (profil)
            if (!repondu && !aime.empty()) {
                std::string relancesProfil[3] = {
                    "Moi j'aime bien discuter, et toi tu aimes " + aime + ", c'est ca ?",
                    "Tu sais, moi je n'ai pas de gout, mais je me souviens que toi tu aimes " + aime + " !",
                    "Toi c'est " + aime + " que tu aimes. Et moi j'aime ecouter !"
                };
                std::cout << botNom + " : " << relancesProfil[prochainIndice(3)] << "\n";
                repondu = true;
            }
            // 4. Sinon, on rend la parole a l'utilisateur
            if (!repondu) {
                std::string relancesToi[] = {
                    "Moi ? T'as une vie tellement plus intéressante que la mienne, raconte !",
                    "Haha, on parlera de moi plus tard. Toi d'abord !",
                    "Je préfère écouter, c'est plus sympa. Vas-y, dis-moi tout !",
                    "Moi je suis juste là pour t'écouter, c'est mon truc. Toi par contre, vas-y !",
                    "On parle de toi, pas de moi ! Continue, j'adore t'écouter.",
                    "Je suis là, je t'écoute. C'est pas grave si y'a rien de spécial, raconte quand même.",
                    "Allez, dis-moi un truc marrant. Je suis curieux.",
                    "Je suis patient, vas-y, prends ton temps.",
                    "Toi d'abord, moi je m'occuperai de moi après.",
                    "Franchement, j'aime bien t'écouter. Continue !"
                };
                std::cout << botNom + " : " << relancesToi[prochainIndice(10)] << "\n";
            }
        }
        else if (phraseContientCle(p, "faim")) {
            if (!plat.empty()) {
                std::string reponsesFaim[3] = {
                    "Tu as deja dit que tu aimais " + plat + "... on en mange ?",
                    "Miam, " + plat + " ca me donne faim aussi !",
                    "Et si on se preparait un " + plat + " ?"
                };
                std::cout << botNom + " : " << reponsesFaim[prochainIndice(3)] << "\n";
            }
            else
                std::cout << botNom + " : Tu as faim ? Parle-moi de ce que tu aimes manger.\n";
        }
        else if (phraseContientCle(p, "ennui")) {
            if (!hobby.empty()) {
                std::string reponsesEnnui[3] = {
                    "Tu t'ennuies ? Et ton activite preferee, " + hobby + " ?",
                    "Allez, on fait du " + hobby + " ensemble ?",
                    "Je parie qu'un peu de " + hobby + " te rejouirait !"
                };
                std::cout << botNom + " : " << reponsesEnnui[prochainIndice(3)] << "\n";
            }
            else
                std::cout << botNom + " : Tu t'ennuies ? Parle-moi de ce que tu aimes faire.\n";
        }

        // ============ MODE INTELLIGENT : reactions humaines ============
        else if (mode == 2) {
            // 0. S'il demande la bonne reponse du quiz en cours, on la donne (toujours)
            if (categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0 &&
                derniereQuestionQuiz[categorieActuelle] >= 0 && demandeLaReponse(p)) {
                int c = categorieActuelle;
                int q = derniereQuestionQuiz[c];
                derniereQuestionQuiz[c] = -1;
                std::cout << botNom + " : Pas de souci ! La bonne reponse : " << reponsesQuiz[c][q] << "\n";
                std::cout << botNom + " : " << relancesQuiz[c][q] << "\n";
                dernierSujet = p;
                continue;
            }

            // 0bis. Un simple "oui"/"non"/"ok" sans question de quiz en attente :
            // l'IA accuse reception au lieu de composer une phrase hors-sujet
            // (elle ne doit pas parler toute seule de sujets non abordes).
            {
                bool quizEnAttenteM2 = categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0 &&
                                       derniereQuestionQuiz[categorieActuelle] >= 0;
                if (!quizEnAttenteM2 && p.find('?') == std::string::npos && estSimpleAcquiescement(p)) {
                    std::cout << botNom + " : " << reactionReponse(p) << "\n";
                    dernierSujet = p;
                    continue;
                }
            }

            // 2. L'utilisateur pose une question ? L'IA repond comme un humain
            if (phrase.find('?') != std::string::npos) {
                bool repondu = false;
                for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
                for (int i = 0; i < 50 && !repondu; i++) {
                    if (motsCles[i].empty()) break;
                    if (phraseContientCle(p, motsCles[i])) {
                        std::cout << botNom + " : " << reponsesIA[i] << "\n";
                        repondu = true;
                        dernierSujet = p;
                        derniereQuestionPosee = -1;
                    }
                }
                if (repondu) continue;
                // si pas de reponse connue : quand la question porte sur un theme
                // exploitable, il construit sa propre phrase autour de ce theme
                // (bloc PHRASE) ; sinon il repond avec humilite.
                {
                    static const char* inconnu[3] = {
                        "Bonne question ! Je n'y avais pas pense.",
                        "Hmm, je ne sais pas encore. Qu'en penses-tu ?",
                        "Interessant... Et toi, tu en penses quoi ?"
                    };
                    // Une question factuelle ("quelle est la capitale du japon ?",
                    // "qui est xavier ?") n'a pas de reponse composee raisonnable :
                    // plutot qu'une phrase hors-sujet, on renvoie vers l'apprentissage
                    // (le bloc PHRASE fabriquait des reponses absurdes dans ce cas).
                    if (estQuestionFactuelle(p)) {
                        std::cout << botNom + " : Je ne connais pas encore la reponse a ca. "
                                     "Apprends-la-moi en disant par exemple : \"je t'apprends que X est Y\" !\n";
                    }
                    else if (!extraireTheme(phrase).empty())
                        std::cout << botNom + " : " << construirePhraseBloc(phrase, nom, age, hobby, aime, aimePas, genre, cles, vocabulaire, motsFavoris) << "\n";
                    else
                        std::cout << botNom + " : " << inconnu[prochainIndice(3)] << "\n";
                }
                dernierSujet = p;
                continue;
            }

            // 3. Une question vient d'etre posee ? L'IA reagit a la reponse puis relance
            if (categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0 && derniereQuestionQuiz[categorieActuelle] >= 0) {
                // On accepte n'importe quelle reponse : on valide d'abord si elle
                // correspond a la bonne reponse, puis on donne la relance.
                int c = categorieActuelle;
                int q = derniereQuestionQuiz[c];
                derniereQuestionQuiz[c] = -1;
                if (reponseProche(p, reponsesQuiz[c][q])) {
                    std::cout << botNom + " : Exact ! " << reponsesQuiz[c][q] << "\n";
                }
                else {
                    std::cout << botNom + " : " << reactionReponse(p) << "\n";
                    std::cout << botNom + " : Pour moi, c'est : " << reponsesQuiz[c][q] << "\n";
                }
                std::cout << botNom + " : " << relancesQuiz[c][q] << "\n";
                dernierSujet = p;
                continue;
            }
            if (derniereQuestionPosee >= 0) {
                int q = derniereQuestionPosee;
                derniereQuestionPosee = -1;
                std::cout << botNom + " : " << relances[q] << "\n";
                dernierSujet = p;
                continue;
            }

            // 3bis. Il est d'accord / enchaîne ("moi aussi", "pareil", "j'aime ca"...) :
            // on rebondit sur la derniere phrase au lieu de repondre dans le vide.
            bool accord = p.find("moi aussi") != std::string::npos ||
                          p.find("pareil") != std::string::npos ||
                          p.find("j'aime ca") != std::string::npos ||
                          p.find("j'aime ca !") != std::string::npos ||
                          p.find("oui j'aime") != std::string::npos ||
                          p.find("exactement") != std::string::npos ||
                          p.find("c'est ca") != std::string::npos ||
                          p.find("c est ca") != std::string::npos;
            if (accord && !dernierSujet.empty() && dernierSujet != p) {
                std::cout << botNom + " : Ah oui, " << dernierSujet << " ! On est d'accord la-dessus.\n";
                dernierSujet = p;
                continue;
            }

            // 4. Il retrouve un mot appris dans l'historique. On ne rebondit que si
            // le mot revient DANS la phrase actuelle (l'utilisateur y retouche) et
            // qu'il avait deja ete employe dans un message precedent : sinon, dire
            // "tu reparles de X" quand X n'est pas dans le message serait absurde.
            bool relie = false;
            for (unsigned int i = 0; i < cles.size() && !relie; i++) {
                if (!phraseContientCle(p, cles[i])) continue;
                // le dernier element d'historique est la phrase actuelle : on la
                // laisse de cote, seules les mentions anterieures comptent.
                for (unsigned int j = 0; j + 1 < historique.size() && !relie; j++) {
                    std::string hj = minuscules(historique[j]);
                    if (phraseContientCle(hj, cles[i])) {
                        std::cout << botNom + " : Tiens, tu reparles de \"" << cles[i] << "\" ? On en avait deja parle.\n";
                        relie = true;
                        dernierSujet = p;
                    }
                }
            }
            if (relie) continue;

            // 5. Question factuelle sans "?" ("quelle est la capitale du japon")
            // : on evite de repondre par une phrase composee hors-sujet.
            if (estQuestionFactuelle(p)) {
                std::cout << botNom + " : Je ne connais pas encore la reponse a ca. "
                             "Apprends-la-moi en disant par exemple : \"je t'apprends que X est Y\" !\n";
                dernierSujet = p;
                continue;
            }
            // 6. Sinon, fallback intelligent : repondre au contenu du message
            {
                int indexQ;
                if (categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0) {
                    // Quiz de la categorie : question -> reponse -> relance
                    int c = categorieActuelle;
                    indexQ = (dernierQuestion + 1) % tailleQuiz[c];   // ordre fixe, pas de hasard
                    derniereQuestionQuiz[c] = indexQ;
                    derniereQuestionPosee = -1;
                    dernierQuestion = indexQ;
                    if (categorieChangee) std::cout << botNom + " : Parlons de " << nomCategories[c] << " !\n";
                    std::cout << botNom + " : " << questionsQuiz[c][indexQ] << "\n";
                }
                else if (categorieActuelle > 0) {
                    int taille = 0;
                    while (questionsParCategorie[categorieActuelle][taille] != -1) taille++;
                    if (categorieChangee) std::cout << botNom + " : Parlons de " << nomCategories[categorieActuelle] << " !\n";
                    indexQ = questionsParCategorie[categorieActuelle][prochainIndice(taille)];
                    dernierQuestion = indexQ;
                    derniereQuestionPosee = indexQ;
                    std::cout << botNom + " : " << questions[indexQ] << "\n";
                }
                else {
                    // Fallback intelligent : repondre au contenu du message utilisateur
                    std::string theme = extraireTheme(phrase);
                    if (!theme.empty() && extraireSujetQuestion(p).empty()) {
                        // L'utilisateur a mentionne un sujet -> construire une phrase autour
                        std::cout << botNom + " : " << construirePhraseBloc(phrase, nom, age, hobby, aime, aimePas, genre, cles, vocabulaire, motsFavoris) << "\n";
                    }
                    else if (!dernierSujet.empty() && dernierSujet != p) {
                        // Relancer sur le dernier sujet discute
                        std::string relancesSujet[3] = {
                            "On parlait de " + dernierSujet + " non ? Continue !",
                            "Tu m'avais parle de " + dernierSujet + ", qu'en penses-tu encore ?",
                            "Dis-moi davantage sur " + dernierSujet + " !"
                        };
                        std::cout << botNom + " : " << relancesSujet[prochainIndice(3)] << "\n";
                    }
                    else {
                        // Aucun contexte -> ouvrir la discussion
                        std::string ouvertures[3] = {
                            "Raconte-moi davantage !",
                            "Dis-moi quelque chose !",
                            "Qu'est-ce que tu as fait aujourd'hui ?"
                        };
                        std::cout << botNom + " : " << ouvertures[prochainIndice(3)] << "\n";
                    }
                }
            }
            dernierSujet = p;
        }

        // ============ MODE NORMAL : BLAMUNE repond ou pose ses questions ============
        else {
            // si le sujet change, on laisse tomber les questions de quiz en attente
            if (categorieChangee) {
                for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
            }

            // Si une question vient d'etre posee, la reponse de l'utilisateur est apprise en silence
            if (derniereQuestionPosee >= 0 && phrase.find('?') == std::string::npos) {
                std::string cle = motsCles[derniereQuestionPosee];
                profilReponses[cle] = phrase;
                sauvegarderProfil(profilReponses);
                derniereQuestionPosee = -1;
                continue;
            }

            // Un simple "oui"/"non"/"ok" sans question en attente : BLAMUNE accuse
            // reception au lieu de composer une phrase hors-sujet.
            {
                bool quizEnAttenteM1 = categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0 &&
                                       derniereQuestionQuiz[categorieActuelle] >= 0;
                if (!quizEnAttenteM1 && p.find('?') == std::string::npos && estSimpleAcquiescement(p)) {
                    std::cout << botNom + " : " << reactionReponse(p) << "\n";
                    dernierSujet = p;
                    continue;
                }
            }

            // Si l'utilisateur pose une question, BLAMUNE cherche une reponse.
            bool repondu = false;
            if (phrase.find('?') != std::string::npos) {
                // Il pose sa propre question : le quiz en cours est abandonne (sinon
                // il "coincerait" le message suivant) et on repond d'abord a sa
                // question avant de relancer la discussion.
                for (int c = 0; c < 14; c++) derniereQuestionQuiz[c] = -1;
                derniereQuestionPosee = -1;
                // Connaissances partagees (savoir.txt) : on repond avec ce qui a ete appris.
                // Le mot ecrit en toutes lettres gagne sur un mot simplement proche.
                for (unsigned int i = 0; i < cles.size() && !repondu; i++) {
                    if (phraseContientCleExact(p, cles[i])) {
                        std::cout << botNom + " : " << reponses[i] << "\n";
                        repondu = true;
                        dernierSujet = p;
                    }
                }
                for (unsigned int i = 0; i < cles.size() && !repondu; i++) {
                    if (phraseContientCle(p, cles[i])) {
                        std::cout << botNom + " : " << reponses[i] << "\n";
                        repondu = true;
                        dernierSujet = p;
                    }
                }
                // Questions-reponses connues (motsCles)
                for (int i = 0; i < 50 && !repondu; i++) {
                    if (motsCles[i].empty()) break;
                    if (phraseContientCle(p, motsCles[i])) {
                        std::cout << botNom + " : " << reponsesIA[i] << "\n";
                        repondu = true;
                        dernierSujet = p;
                    }
                }
                // Pas de reponse connue : on le dit au lieu d'avaler la question.
                // Quand la question porte sur un theme exploitable, on construit
                // parfois une phrase autour de ce theme (bloc PHRASE) ; une question
                // factuelle ("quelle est la capitale de X ?") n'a pas de phrase
                // composee raisonnable, on renvoie vers l'apprentissage.
                if (!repondu) {
                    if (estQuestionFactuelle(p))
                        std::cout << botNom + " : Je ne connais pas encore la reponse a ca. Apprends-la-moi en disant par exemple : \"je t'apprends que X est Y\" !\n";
                    else if (!extraireTheme(phrase).empty() && prochainIndice(2) == 0)
                        std::cout << botNom + " : " << construirePhraseBloc(phrase, nom, age, hobby, aime, aimePas, genre, cles, vocabulaire, motsFavoris) << "\n";
                    else
                        std::cout << botNom + " : Bonne question ! Je n'y avais pas pense.\n";
                    repondu = true;
                    dernierSujet = p;
                }
            }
            else {
                // Pas une question : on repond avec les connaissances partagees.
                // Le mot ecrit en toutes lettres gagne sur un mot simplement proche.
                for (unsigned int i = 0; i < cles.size() && !repondu; i++) {
                    if (phraseContientCleExact(p, cles[i])) {
                        std::cout << botNom + " : " << reponses[i] << "\n";
                        repondu = true;
                        dernierSujet = p;
                    }
                }
                for (unsigned int i = 0; i < cles.size() && !repondu; i++) {
                    if (phraseContientCle(p, cles[i])) {
                        std::cout << botNom + " : " << reponses[i] << "\n";
                        repondu = true;
                        dernierSujet = p;
                    }
                }
            }

            // Reaction a la reponse du quiz : on accepte n'importe quelle reponse,
            // on la valide, puis on donne la bonne reponse avant la suite.
            if (categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0 &&
                derniereQuestionQuiz[categorieActuelle] >= 0 && !repondu) {
                int c = categorieActuelle;
                int q = derniereQuestionQuiz[c];
                derniereQuestionQuiz[c] = -1;
                if (demandeLaReponse(p)) {
                    std::cout << botNom + " : Pas de souci ! La bonne reponse : " << reponsesQuiz[c][q] << "\n";
                }
                else if (reponseProche(p, reponsesQuiz[c][q])) {
                    std::cout << botNom + " : Exact ! " << reponsesQuiz[c][q] << "\n";
                }
                else {
                    std::cout << botNom + " : " << reactionReponse(p) << "\n";
                    std::cout << botNom + " : Pour moi, c'est : " << reponsesQuiz[c][q] << "\n";
                }
                std::cout << botNom + " : " << relancesQuiz[c][q] << "\n";
                dernierSujet = p;
                repondu = true;
            }

            // BLAMUNE passe a la prochaine question
            if (!repondu) {
                int index;
                if (categorieActuelle >= 0 && questionsQuiz[categorieActuelle] != 0) {
                    // Quiz de la categorie : on pose une question du quiz
                    int c = categorieActuelle;
                    index = prochainIndice(tailleQuiz[c]);
                    derniereQuestionQuiz[c] = index;
                    derniereQuestionPosee = -1;
                    dernierQuestion = index;
                    if (categorieChangee) std::cout << botNom + " : Parlons de " << nomCategories[c] << " !\n";
                    std::cout << botNom + " : " << questionsQuiz[c][index] << "\n";
                }
                else if (categorieActuelle > 0) {
                    int taille = 0;
                    while (questionsParCategorie[categorieActuelle][taille] != -1) taille++;
                    if (categorieChangee) std::cout << botNom + " : Parlons de " << nomCategories[categorieActuelle] << " !\n";
                    index = questionsParCategorie[categorieActuelle][prochainIndice(taille)];
                    dernierQuestion = index;
                    derniereQuestionPosee = index;
                    std::cout << botNom + " : " << questions[index] << "\n";
                }
                else {
                    // Fallback intelligent : repondre au contenu du message utilisateur
                    std::string theme = extraireTheme(phrase);
                    if (!theme.empty() && extraireSujetQuestion(p).empty()) {
                        std::cout << botNom + " : " << construirePhraseBloc(phrase, nom, age, hobby, aime, aimePas, genre, cles, vocabulaire, motsFavoris) << "\n";
                    }
                    else if (!dernierSujet.empty() && dernierSujet != p) {
                        std::string relancesSujet[] = {
                            "On parlait de " + dernierSujet + " non ? Continue !",
                            "Tu m'avais parle de " + dernierSujet + ", qu'en penses-tu encore ?",
                            "Dis-moi davantage sur " + dernierSujet + " !",
                            "On en etait ou avec " + dernierSujet + " déjà ?",
                            "Tu disais des trucs intéressants sur " + dernierSujet + " !"
                        };
                        std::cout << botNom + " : " << relancesSujet[prochainIndice(5)] << "\n";
                    }
                    else {
                        std::string ouvertures[] = {
                            "Raconte-moi un truc qui t'est arrivé récemment.",
                            "Dis-moi n'importe quoi, je suis là.",
                            "J'suis curieux, vas-y, raconte-moi ta journée.",
                            "Et sinon quoi de neuf dans ta vie ?",
                            "Allez, dis-moi un truc marrant.",
                            "Tu fais quoi de beau aujourd'hui ?",
                            "Dis-moi un truc, même si c'est n'importe quoi.",
                            "Raconte-moi n'importe quoi, j'adore t'écouter.",
                            "T'as un truc en tête ? Même un petit rien.",
                            "Vas-y, dis-moi un truc, même si c'est bête.",
                            "On fait quoi ? Raconte-moi ta vie.",
                            "Et toi, c'est quoi ton truc en ce moment ?"
                        };
                        std::cout << botNom + " : " << ouvertures[prochainIndice(12)] << "\n";
                    }
                }
            }
        }
    }

    // ============ SAUVEGARDE DU PROFIL ============
    // (les mots favoris et le profil sont reecrits par sauvegarderMemoire())
    sauvegarderMemoire();
    std::string adieux[] = {
        "Au revoir " + nom + " ! ca m'a fait plaisir de te parler. A bientot !",
        "Salut " + nom + " ! C'etait cool. On se reparle bientôt !",
        "Bye " + nom + " ! Prends soin de toi, A� bientot !",
        "A plus " + nom + " ! C'etait sympa, reviens vite !",
        "Au revoir " + nom + " ! J'ai bien kiffe notre discussion. À bientôt !",
        "Salut " + nom + " ! C'etait chouette, à bientôt !",
        "Bye bye " + nom + " ! C'etait chouette. On se revoit !"
    };
    std::cout << "\n" << adieux[prochainIndice(7)] << "\n";
    return 0;
}
