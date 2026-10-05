# Callsign rules (draft for review)

## Format
- Three tags from `tags.toml` → `[allowed]`, lowercase, joined by hyphens: `plaidshirt-comfy-1keoy`
- Three different tags; order is the draw order.
- Tags longer than 13 characters are excluded so callsigns stay readable.

## Drawing
- Each tag's chance of being drawn is proportional to √(number of memes with that tag).
  - Square root keeps iconic tags common without drowning everything else.
  - With straight counts, sergey/linkpilled/pepe would appear in most callsigns; with √ sergey appears in ~13%.
- Drawn once, at enlistment. **Permanent** — no rerolls.
- Unique: no two Marines share the same three tags (in any order). On a clash, draw again.
- The most iconic combinations get claimed first, which gives early enlistees another bit of status.

## Rarity
Rarity is set by how surprising the three tags are together: the sum of −log(chance) over the three tags.
Cut-offs come from simulating 200,000 draws, so the shares stay fixed:

| Tier | Share | Meaning |
|---|---|---|
| Common | 60% | mostly well-known tags |
| Uncommon | 25% | |
| Rare | 12% | |
| Legendary | 3% | tags from memes that exist once or twice in the archive |

Rarity cut-offs are snapshotted at launch, so a Marine's tier never changes as the archive grows.

## Samples (current list, seeded so you can compare after edits)

**Common**
- `clown-rory-pepe`
- `trippy-ari-ironhand`
- `4ir-clg-linkpilled`
- `4ir-chad-pepe`
- `simpson-1keoy-sergey`
- `plaidshirt-fud-bobs`
- `wtfwasthat-frenando-art`
- `movieposter-price-777`
- `comfy-art-defi`
- `chad-dance-who`

**Uncommon**
- `party-4ir-deep`
- `mememagic-clippy-mug`
- `art-surfwaves-nintendo`
- `space-nolinkers-tattoo`
- `coffin-don-ari`
- `robot-breadcrumb-glowy`
- `zelda-partycrash-monopoly`
- `thrasher-ed-pepe`
- `happening-vitalik-linkie`
- `cycle-movies-trippy`

**Rare**
- `ship-rocket-matrix`
- `yes-glowy-millionaire`
- `davey-chart-wojak`
- `ironhand-adelyn-gm`
- `pixel-matrix-dance`
- `partycrash-bags-kek`
- `magicbus-10dollar-excited`
- `42-whale-time`
- `spoonfeed-ducksinarow-81000`
- `micdrop-dance-thomas`

**Legendary**
- `painting-game-general`
- `herewego-clg-zombie`
- `tattoo-craps-cat`
- `zoomer-staypoor-yachtparty`
- `craps-surfwaves-linkglow`
- `painting-space-prophecy`
- `micdrop-libra-ed`
- `youhad3years-cope-millionaire`
- `libra-ethereum-casino`
- `magic-linkglow-rick`

## Open questions for you
1. Is 13 characters the right length cap? It keeps `fundamentally` and `networkeffect`; the cut tags are the long phrases (allinthistogether, positivethought, poweredbychainlink, weareallgonnamakeit, weareallinthistogether, wearegonnamakeit).
2. Should sergey/ari/rory stay? I kept them as core lore.
