# LTE-Calc - 5G NR short report

## Data used and impact on configuration

- **Roads and speeds** (Source: Overpass API).

  We compute an average and a maximum speed. This feeds the mobility score via normalization (avg 20..80 km/h, max
  50..130 km/h). High mobility pushes the frequency toward 700 MHz for coverage.


- **Road density** (Source: Overpass API).

  The number of roads per km2 is normalized (20..400) and contributes to the mobility (20%) and traffic (10%) scores.


- **Buildings (footprints and areas)** (Source: Overpass API).

  Footprints are used to compute areas. The area score (avg 50..400 m2, max 200..2000 m2) enters clutter. Building
  count per km2 (50..800) contributes to traffic.


- **Urban density per cell** (Source: derived from OSM buildings).

  100 m grid of building counts, normalized per cell. The density score (avg 0.15..0.6, max 0.3..0.9) feeds clutter
  and traffic. In advanced mode, local density increases local losses and local clutter.


- **Building height** (Source: IGN Geoportail altimetry / LiDAR via data.geopf.fr).

  The height score (avg 8..35 m, max 15..80 m) feeds clutter and losses. Heights are also used for street canyons.


- **Street canyon index** (Source: OSM roads + IGN heights).

  Index = mean building height / road width (lanes/width or defaults). The canyon score (avg 0.3..1.6, max 0.8..2.5)
  feeds clutter, frequency, and CP.


- **Vegetation** (Source: IGN WFS BDTOPO zone_de_vegetation in France; fallback ESA WorldCover 2021 COG).

  Vegetation coverage is normalized (0.1..0.6) and contributes to clutter, frequency, and losses.


- **Relief and elevation** (Source: IGN Geoportail altimetry / LiDAR via data.geopf.fr, France only).

  The relief score combines mean slope (2..12 %) and elevation range (10..80 m). It feeds clutter and CP. In advanced
  mode, elevation selects antenna candidates and local slope adds losses.

## Derived scores (normalized to [0,1])

- **Mobility** = 0.8 * speedScore + 0.2 * roads/km2, with speedScore = 0.6 * norm(avg speed) + 0.4 * norm(max speed).
- **Density** = 0.6 * norm(avg density) + 0.4 * norm(max density).
- **Clutter** = 0.25 * canyon + 0.25 * height + 0.2 * density + 0.15 * vegetation + 0.1 * relief + 0.05 * area.
- **Traffic** = 0.45 * density + 0.25 * mobility + 0.2 * buildings/km2 + 0.1 * roads/km2.

## Main decision rules (nrConfig.js)

**Bandwidth** (traffic score)

| Condition    | Bandwidth |
|--------------|-----------|
| score < 0.25 | 10 MHz    |
| score < 0.45 | 20 MHz    |
| score < 0.65 | 40 MHz    |
| score < 0.85 | 80 MHz    |
| otherwise    | 100 MHz   |

**SCS** (mobility score)

| Condition                       | SCS                     |
|---------------------------------|-------------------------|
| score < 0.35                    | 15 kHz                  |
| score < 0.60                    | 30 kHz                  |
| score < 0.80                    | 60 kHz                  |
| otherwise                       | 120 kHz                 |
| clutter > 0.70 and SCS > 15 kHz | reduce by one step      |
| clutter > 0.85 and SCS > 30 kHz | reduce by one more step |

**Frequency**

| Condition                                                                                     | Frequency |
|-----------------------------------------------------------------------------------------------|-----------|
| very high clutter (clutter>=0.8 or vegetation>=0.6 or canyon>=0.85) or mobility>=0.75         | 700 MHz   |
| low clutter (clutter<0.6 and vegetation<0.45 and canyon<0.7) + traffic>=0.65 + mobility<=0.55 | 24 GHz    |
| high clutter (clutter>=0.6 or vegetation>=0.45 or canyon>=0.7) + traffic>=0.45                | 3.5 GHz   |
| otherwise                                                                                     | 3.5 GHz   |

**Cyclic Prefix**

| Condition                                                            | CP       |
|----------------------------------------------------------------------|----------|
| (clutter > 0.75 or canyon > 0.85 or relief > 0.75) and SCS >= 60 kHz | extended |
| otherwise                                                            | normal   |

## Two computation methods (basic vs advanced)

Both methods use the same data, but apply them differently to estimate antenna and coverage.

- **Basic**: uses global averages (density, vegetation, relief, canyon, height) to estimate losses, places the antenna
  at the center, and sizes EIRP for a -95 dBm threshold.
- **Advanced**: computes local losses per cell (density, vegetation, relief, canyon, height), chooses antenna candidates
  via elevation - local clutter, then keeps the one with the best minimum signal (then average signal, then coverage).
  EIRP is adjusted to the same threshold.
