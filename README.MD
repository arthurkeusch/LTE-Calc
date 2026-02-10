# LTE-Calc - Rapport court 5G NR

## Donnees utilisees et impact sur la configuration

- **Routes et vitesses** (Source: OpenStreetMap via Overpass API).

  Les vitesses maxspeed et le type de route servent a calculer une vitesse moyenne et maximale.

  Cela alimente le score de mobilite:
    - mobilite faible -> SCS 15/30 kHz
    - mobilite elevee -> SCS 60/120 kHz.

  Une mobilite tres elevee pousse aussi la frequence vers 700 MHz pour la couverture.


- **Densite de routes** (Source: OpenStreetMap via Overpass API).

  Le nombre de routes par km2 alimente le score de trafic. Plus il est eleve, plus la bande passante choisie monte (
  10/20/40/80/100 MHz selon les seuils).


- **Batiments (empreintes et surfaces)** (Source: OpenStreetMap via Overpass API).

  La surface moyenne/max et le nombre de batiments par km2 augmentent le score de densite et de clutter, ce qui favorise
  des frequences plus basses (700/3.5 GHz) et peut reduire la SCS.


- **Hauteur des batiments** (Source: IGN Geoportail altimetrie / LiDAR via data.geopf.fr).

  La hauteur moyenne/max augmente le score de hauteur et sert au calcul des canyons urbains. Des batiments plus hauts
  augmentent le multipath, ce qui peut diminuer la SCS et activer un CP "extended".


- **Densite urbaine par cellule** (Source: derivee des batiments OSM).

  Elle sert a la densite locale dans la simulation avancee: plus la densite est forte, plus les pertes locales
  augmentent et plus l'antenne est placee haut.


- **Indice de canyon urbain** (Source: routes OSM + hauteurs IGN).

  Calcule a partir des hauteurs de batiments et de la largeur de route (lanes/width). Un indice eleve augmente le
  clutter et peut imposer un CP etendu si la SCS est >= 60 kHz.


- **Vegetation** (Source: IGN WFS BDTOPO zone_de_vegetation en France; fallback ESA WorldCover 2021 COG).

  La couverture vegetation augmente le clutter et les pertes; une couverture elevee favorise une frequence plus basse et
  penalise la propagation en simulation.


- **Relief et elevation** (Source: IGN Geoportail altimetrie / LiDAR).

  La pente moyenne et l'amplitude altimetrique augmentent le score de relief; un relief fort + SCS elevee peut imposer
  un CP etendu. En mode avance, l'elevation/pente locale guide le choix d'emplacement d'antenne.


- **Zone d'etude (centre + taille en km)** (Source: entree utilisateur).

  Sert a normaliser les densites (par km2) et a dimensionner les grilles; une zone plus grande augmente la hauteur
  d'antenne estimee et la puissance EIRP necessaire.

## Regles de decision principales (nrConfig.js)

**Bande passante** (score de trafic)

| Condition    | Bande passante |
|--------------|----------------|
| score < 0.25 | 10 MHz         |
| score < 0.45 | 20 MHz         |
| score < 0.65 | 40 MHz         |
| score < 0.85 | 80 MHz         |
| sinon        | 100 MHz        |

**SCS** (score de mobilite)

| Condition                      | SCS                              |
|--------------------------------|----------------------------------|
| score < 0.35                   | 15 kHz                           |
| score < 0.60                   | 30 kHz                           |
| score < 0.80                   | 60 kHz                           |
| sinon                          | 120 kHz                          |
| clutter > 0.70 et SCS > 15 kHz | reduire d'un cran                |
| clutter > 0.85 et SCS > 30 kHz | reduire d'un cran supplementaire |

**Frequence**

| Condition                                       | Frequence |
|-------------------------------------------------|-----------|
| clutter fort ou mobilite elevee                 | 700 MHz   |
| clutter faible + trafic eleve + mobilite faible | 24 GHz    |
| sinon                                           | 3.5 GHz   |

**Cyclic Prefix**

| Condition                                                           | CP       |
|---------------------------------------------------------------------|----------|
| (clutter > 0.75 ou canyon > 0.85 ou relief > 0.75) et SCS >= 60 kHz | extended |
| sinon                                                               | normal   |

## Deux methodes de calcul (basique vs avance)

Les deux methodes utilisent les memes donnees, mais les exploitent differemment pour aboutir a une configuration
optimale.

- **Basique**: utilise des moyennes globales (densite, vegetation, relief, canyon, hauteur) pour estimer les pertes et
  dimensionner l'antenne; la position est au centre de la zone.
- **Avance**: utilise des grilles locales (densite, vegetation, relief) pour estimer les pertes cellule par cellule,
  teste plusieurs candidats d'antenne (elevation vs clutter) et selectionne celui qui maximise la couverture et le
  signal.

## Cache, hebergement et limites

- Cache Redis cote back-end pour limiter l'appel aux API officiels (Overpass, IGN, ESA) et accelerer les reponses, sans
  etre bloque par leurs quotas.
- Site heberge sur serveur personnel, accessible a: https://lte-calc.arthur-keusch.fr/FiveG
- Le volume de donnees est important: l'outil n'est pas recommande pour des zones > 10 km2 si le cache n'est pas deja
  rempli (les temps de collecte deviennent longs).
