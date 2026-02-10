# LTE-Calc - Rapport court 5G NR

## Donnees utilisees et impact sur la configuration

- **Routes et vitesses** (Source: OpenStreetMap via Overpass API).

  Les vitesses proviennent de maxspeed. On calcule une vitesse moyenne et maximale.

  Cela alimente le score de mobilite via une normalisation (avg 20..80 km/h, max 50..130 km/h).

  Une mobilite elevee pousse la frequence vers 700 MHz pour la couverture.


- **Densite de routes** (Source: OpenStreetMap via Overpass API).

  Le nombre de routes par km2 est normalise (20..400) et contribue aux scores de mobilite (20%) et de trafic (10%).


- **Batiments (empreintes et surfaces)** (Source: OpenStreetMap via Overpass API).

  Les empreintes servent a calculer les surfaces. Le score d'aire (avg 50..400 m2, max 200..2000 m2) entre dans le
  clutter. Le nombre de batiments par km2 (50..800) contribue au trafic.


- **Densite urbaine par cellule** (Source: derivee des batiments OSM).

  Grille 100 m de comptage de batiments, normalisee par cellule. Le score de densite (avg 0.15..0.6, max 0.3..0.9)
  alimente le clutter et le trafic. En mode avance, la densite locale augmente les pertes et le clutter local.


- **Hauteur des batiments** (Source: IGN Geoportail altimetrie / LiDAR via data.geopf.fr).

  Le score de hauteur (avg 8..35 m, max 15..80 m) alimente le clutter et les pertes. Les hauteurs servent aussi au
  calcul des canyons urbains.


- **Indice de canyon urbain** (Source: routes OSM + hauteurs IGN).

  Indice = hauteur moyenne des batiments / largeur de route (lanes/width ou valeurs par defaut). Le score canyon
  (avg 0.3..1.6, max 0.8..2.5) alimente le clutter, la frequence et le CP.


- **Vegetation** (Source: IGN WFS BDTOPO zone_de_vegetation en France; fallback ESA WorldCover 2021 COG).

  La couverture vegetation est normalisee (0.1..0.6) et contribue au clutter, a la frequence et aux pertes.


- **Relief et elevation** (Source: IGN Geoportail altimetrie / LiDAR via data.geopf.fr, France uniquement).

  Le score de relief combine la pente moyenne (2..12 %) et l'amplitude altimetrique (10..80 m). Il alimente le clutter
  et le CP. En mode avance, l'elevation sert a choisir des candidats d'antenne et la pente locale ajoute des pertes.


- **Zone d'etude (centre + taille en km)** (Source: entree utilisateur).

  Sert a normaliser les densites (par km2) et a dimensionner les grilles; une zone plus grande augmente la hauteur
  d'antenne estimee et les pertes max (donc l'EIRP).

## Scores derives (normalises sur [0,1])

- **Mobilite** = 0.8 * speedScore + 0.2 * routes/km2, avec speedScore = 0.6 * norm(vitesse avg) + 0.4 * norm(vitesse
  max).
- **Densite** = 0.6 * norm(avg densite) + 0.4 * norm(max densite).
- **Clutter** = 0.25 * canyon + 0.25 * hauteur + 0.2 * densite + 0.15 * vegetation + 0.1 * relief + 0.05 * aire.
- **Trafic** = 0.45 * densite + 0.25 * mobilite + 0.2 * batiments/km2 + 0.1 * routes/km2.

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

| Condition                                                                                     | Frequence |
|-----------------------------------------------------------------------------------------------|-----------|
| clutter tres eleve (clutter>=0.8 ou vegetation>=0.6 ou canyon>=0.85) ou mobilite>=0.75        | 700 MHz   |
| clutter faible (clutter<0.6 et vegetation<0.45 et canyon<0.7) + trafic>=0.65 + mobilite<=0.55 | 24 GHz    |
| clutter eleve (clutter>=0.6 ou vegetation>=0.45 ou canyon>=0.7) + trafic>=0.45                | 3.5 GHz   |
| sinon                                                                                         | 3.5 GHz   |

**Cyclic Prefix**

| Condition                                                           | CP       |
|---------------------------------------------------------------------|----------|
| (clutter > 0.75 ou canyon > 0.85 ou relief > 0.75) et SCS >= 60 kHz | extended |
| sinon                                                               | normal   |

## Deux methodes de calcul (basique vs avance)

Les deux methodes utilisent les memes donnees, mais les exploitent differemment pour estimer l'antenne et la
couverture.

- **Basique**: utilise des moyennes globales (densite, vegetation, relief, canyon, hauteur) pour estimer les pertes,
  place l'antenne au centre et dimensionne l'EIRP pour un seuil de -95 dBm.
- **Avance**: calcule des pertes locales par cellule (densite, vegetation, relief, canyon, hauteur), choisit des
  candidats d'antenne via elevation - clutter local, puis retient celui avec le meilleur signal min (puis signal moyen,
  puis couverture). L'EIRP est ajuste pour le meme seuil.
