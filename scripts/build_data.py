"""Build data.js for the Living Dex app.

Inputs (in ../source):
  availability.wikitext   - Bulbapedia "List of Pokémon by availability" wikitext
  pokeapi_forms.json      - PokeAPI GraphQL dump of pokemon_v2_pokemonform
  pokeapi_formsprites.json- PokeAPI GraphQL dump of pokemon_v2_pokemonformsprites

Output: ../data.js  (window.DEX = {...})
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source"

# All 41 game columns, in Bulbapedia order.
GAMES = [
    ("R", "Red", 1, "#ff1111"), ("G", "Green (Blue)", 1, "#11bb11"), ("BJ", "Blue (JP)", 1, "#1111ff"),
    ("Y", "Yellow", 1, "#ffd733"),
    ("Gd", "Gold", 2, "#daa520"), ("Si", "Silver", 2, "#c0c0c0"), ("Cr", "Crystal", 2, "#4fd9ff"),
    ("Ru", "Ruby", 3, "#a00000"), ("Sa", "Sapphire", 3, "#0000a0"), ("FR", "FireRed", 3, "#ff7327"),
    ("LG", "LeafGreen", 3, "#00dd00"), ("Em", "Emerald", 3, "#00a000"),
    ("Co", "Colosseum", 3, "#b6cae4"), ("XD", "XD", 3, "#604e82"),
    ("D", "Diamond", 4, "#aaaaff"), ("P", "Pearl", 4, "#ffaaaa"), ("Pt", "Platinum", 4, "#999999"),
    ("HG", "HeartGold", 4, "#b69e00"), ("SS", "SoulSilver", 4, "#c0c0e1"),
    ("Bk", "Black", 5, "#444444"), ("Wh", "White", 5, "#e1e1e1"), ("B2", "Black 2", 5, "#424b50"),
    ("W2", "White 2", 5, "#e3ced0"),
    ("X", "X", 6, "#025da6"), ("Yv", "Y", 6, "#ea1a3e"), ("OR", "Omega Ruby", 6, "#ab2813"),
    ("AS", "Alpha Sapphire", 6, "#26649c"),
    ("Su", "Sun", 7, "#f1912b"), ("Mo", "Moon", 7, "#5599ca"), ("US", "Ultra Sun", 7, "#e95b2b"),
    ("UM", "Ultra Moon", 7, "#226db5"), ("LGP", "Let's Go Pikachu", 7, "#f5da26"),
    ("LGE", "Let's Go Eevee", 7, "#d4924b"),
    ("Sw", "Sword", 8, "#00a1e9"), ("Sh", "Shield", 8, "#bf004f"), ("BD", "Brilliant Diamond", 8, "#44baf1"),
    ("SP", "Shining Pearl", 8, "#da7d99"), ("LA", "Legends: Arceus", 8, "#36597b"),
    ("Sc", "Scarlet", 9, "#f34134"), ("Vi", "Violet", 9, "#8334b7"), ("ZA", "Legends: Z-A", 9, "#5dbb63"),
]
G = [g[0] for g in GAMES]


def cols(*ranges):
    out = []
    for r in ranges:
        a, b = r.split(":")
        out += G[G.index(a): G.index(b) + 1]
    return out


# Which game columns each Avail-* template covers (derived from the table headers).
TEMPLATE_COLS = {
    "1": G,
    "2": cols("Gd:UM", "Sw:ZA"),
    "3": cols("Ru:UM", "Sw:ZA"),
    "4": cols("D:UM", "Sw:ZA"),
    # Gen 5+ tables skip Let's Go and BDSP, which have no Pokémon from those generations.
    "5": cols("Bk:UM", "Sw:Sh", "LA:ZA"),
    "6": cols("X:UM", "Sw:Sh", "LA:ZA"),
    "7": cols("Su:UM", "Sw:Sh", "LA:ZA"),
    "7UO": cols("LGP:LGE", "Sw:Sh", "LA:ZA"),
    "8": cols("Sw:Sh", "Sc:ZA"),
    "8H": cols("LA:ZA"),
    "9": cols("Sc:ZA"),
}

# Bulbapedia form suffix -> PokeAPI form_name candidates.
BULBA_FORM_ALIASES = {
    "paldea combat": "paldea-combat-breed", "paldea blaze": "paldea-blaze-breed",
    "paldea aqua": "paldea-aqua-breed", "red": "red-striped", "blue": "blue-striped",
    "white": "white-striped", "full": "full-belly", "low key": "low-key",
}

# Alternate PokeAPI forms that aren't separate entries in a living dex (battle/temporary/unstorable).
EXCLUDE_FORMS = re.compile(
    r"^(totem.*|starter|rock-star|belle|pop-star|phd|libre|cosplay|battle-bond|.*power-construct|"
    r"eternamax|own-tempo|totem-disguised|ultra|overcast|.*-meteor|complete|.*-mode|.*-build|"
    r"galar-zen|zen|busted|school|hangry|crowned|noice|pirouette|blade|primal|.*-gmax|gmax|"
    r"stellar|terastal|hero)$"
)
REGIONAL = re.compile(r"^(alola|galar|hisui|paldea.*|galar-standard)$")
# Species whose alternate forms all look identical (only the evolution differs), so not tracked.
IDENTICAL_FORM_SPECIES = {414, 664, 665}
# Species whose genders are already separate forms (Meowstic, Indeedee, Oinkologne).
SEPARATE_GENDER_FORMS = {678, 876, 916}
CHANGEABLE_SPECIES = {
    386, 479, 483, 484, 487, 492, 493, 641, 642, 645, 646, 647, 648, 649, 676, 718, 720, 741,
    773, 800, 898, 905, 964, 1017,
}

LABEL_WORDS = {"alola": "Alolan", "galar": "Galarian", "hisui": "Hisuian", "paldea": "Paldean",
               "poke": "Poké", "la": "La", "phd": "PhD"}


def form_label(form_name):
    if form_name in ("exclamation", "question"):
        return "!" if form_name == "exclamation" else "?"
    if len(form_name) == 1:
        return form_name.upper()
    words = form_name.split("-")
    out = []
    for i, w in enumerate(words):
        if w == "ball" and i and words[i - 1] == "poke":
            out[-1] = "Poké Ball"
            continue
        out.append(LABEL_WORDS.get(w, w.capitalize()))
    return " ".join(out).replace(" Striped", "-Striped").replace(" Of ", " of ").replace("Spiky Eared", "Spiky-Eared")


def parse_bulbapedia():
    text = (SRC / "availability.wikitext").read_text(encoding="utf8")
    rows = []
    for tmpl, body in re.findall(r"\{\{Avail-(\w+)\|([^}]*)\}\}", text):
        parts = body.split("|")
        form = next((p.split("=", 1)[1] for p in parts if p.startswith("form=")), "")
        notes = {p.split("=", 1)[0][:-4]: p.split("=", 1)[1] for p in parts if re.match(r"\w+note=", p)}
        pos = [p.strip() for p in parts if "=" not in p and p.strip() != ""]
        num, name, codes = int(pos[0]), pos[1], pos[2:]
        games = TEMPLATE_COLS[tmpl]
        if len(codes) != len(games):
            raise SystemExit(f"Column mismatch for {name}{form} ({tmpl}): {len(codes)} vs {len(games)}")
        avail = {g: c for g, c in zip(games, codes) if c != "—"}
        note_map = {"C": "Cr", "FRLG": "FR", "Colo": "Co"}
        rows.append({
            "num": num, "name": name, "form": form.lstrip("-"),
            "avail": avail,
            "notes": {note_map.get(k, k): v for k, v in notes.items()},
        })
    return rows


def load_pokeapi():
    forms = json.loads((SRC / "pokeapi_forms.json").read_text(encoding="utf8"))["data"]["pokemon_v2_pokemonform"]
    sprites = json.loads((SRC / "pokeapi_formsprites.json").read_text(encoding="utf8"))["data"]["pokemon_v2_pokemonformsprites"]
    sprite_by_form = {s["pokemon_form_id"]: (s["sprites"] or {}).get("front_default") for s in sprites}
    female_by_form = {s["pokemon_form_id"]: (s["sprites"] or {}).get("front_female") for s in sprites}
    by_species = defaultdict(list)
    for f in forms:
        sp = f["pokemon_v2_pokemon"]["pokemon_species_id"]
        if sp > 1025:
            continue
        f["sprite"] = sprite_by_form.get(f["id"])
        f["female_sprite"] = female_by_form.get(f["id"])
        by_species[sp].append(f)
    return by_species


def short_sprite(url):
    prefix = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/"
    return url[len(prefix):] if url and url.startswith(prefix) else url


def main():
    rows = parse_bulbapedia()
    api = load_pokeapi()

    bulba = defaultdict(dict)  # num -> {form_slug: row}
    names = {}
    for r in rows:
        bulba[r["num"]][r["form"].lower()] = r
        names.setdefault(r["num"], r["name"])

    entries = []
    unmatched = []
    for num in sorted(names):
        forms = sorted(api.get(num, []), key=lambda f: (not f["pokemon_v2_pokemon"]["is_default"], f["id"]))
        default = next((f for f in forms if f["pokemon_v2_pokemon"]["is_default"] and f["is_default"]), forms[0] if forms else None)
        brows = bulba[num]
        base_row = brows.get("") or next(iter(brows.values()))
        default_slug = "" if "" in brows else next(iter(brows))

        def fsprite(f):
            if not f:
                return None
            if f["sprite"]:
                return short_sprite(f["sprite"])
            # PokeAPI has no form-sprite record for some newer forms (e.g. Paldean Wooper), but the sprite
            # repo still has the image under the form's own Pokémon id, or as "<dex>-<form>.png".
            if f["form_name"] and f["pokemon_id"] != num:
                return f"{f['pokemon_id']}.png"
            if f["form_name"]:
                return f"{num}-{f['form_name']}.png"
            return None

        api_by_name = {f["form_name"]: f for f in forms}

        def add_with_female(entry, f):
            """Append an entry, followed by its female variant if that looks visibly different."""
            entries.append(entry)
            if not f or not f["female_sprite"] or f["is_mega"] or num in SEPARATE_GENDER_FORMS:
                return
            entry["hasFemale"] = True
            entries.append({
                **entry, "id": f"{entry['id']}-female", "label": " ".join(filter(None, [entry["label"], "♀"])),
                "cat": "gender", "parentCat": entry["cat"], "sprite": short_sprite(f["female_sprite"]),
                "inherited": True, "hasFemale": False,
            })

        # Default entry
        base = {
            "id": str(num), "num": num, "name": names[num],
            "form": "", "label": "", "cat": "base",
            "sprite": fsprite(default) or f"{num}.png",
            "avail": base_row["avail"], "notes": base_row["notes"],
        }
        if default_slug:
            base["label"] = form_label(BULBA_FORM_ALIASES.get(default_slug, default_slug.replace(" ", "-")))
        if num == 774:  # Minior: show the Red Core rather than the identical-looking meteor shell
            base["label"] = "Red Core"
            base["sprite"] = fsprite(api_by_name.get("red")) or base["sprite"]
        elif default and default["form_name"] and not base["label"]:
            base["label"] = form_label(default["form_name"])
        add_with_female(base, default)
        used_api = {default["form_name"]} if default else set()

        # Alternate forms listed by Bulbapedia (they carry their own availability)
        for slug, r in brows.items():
            if slug == default_slug:
                continue
            key = BULBA_FORM_ALIASES.get(slug, slug.replace(" ", "-"))
            f = api_by_name.get(key)
            if f is None:
                f = next((x for x in forms if x["form_name"].startswith(key)), None)
            if f is None:
                unmatched.append(f"{names[num]}-{slug}")
            else:
                used_api.add(f["form_name"])
            cat = "regional" if REGIONAL.match(key) or slug == "bloodmoon" else (
                "changeable" if num in CHANGEABLE_SPECIES else "variant")
            add_with_female({
                "id": f"{num}-{key}", "num": num, "name": names[num], "form": key,
                "label": form_label(key) if not slug == "bloodmoon" else "Bloodmoon",
                "cat": cat, "sprite": fsprite(f) or base["sprite"],
                "avail": r["avail"], "notes": r["notes"],
            }, f)

        # Remaining storable PokeAPI forms (cosmetic forms Bulbapedia lumps with the species)
        for f in forms:
            fn = f["form_name"]
            if not fn or fn in used_api or f["is_battle_only"] or f["is_mega"] or EXCLUDE_FORMS.match(fn):
                continue
            if (num == 774 and fn == "red") or num in IDENTICAL_FORM_SPECIES:
                continue
            if num == 25 and fn.endswith("cap"):
                cat = "variant"
            elif REGIONAL.match(fn):
                cat = "regional"
            elif num in CHANGEABLE_SPECIES:
                cat = "changeable"
            else:
                cat = "variant"
            entries.append({
                "id": f"{num}-{fn}", "num": num, "name": names[num], "form": fn,
                "label": form_label(fn), "cat": cat, "sprite": fsprite(f) or base["sprite"],
                "avail": base["avail"], "notes": {}, "inherited": True,
            })
            used_api.add(fn)

    per_species = defaultdict(int)
    for e in entries:
        per_species[e["num"]] += 1
    for e in entries:
        if e["cat"] == "base" and per_species[e["num"]] == 1 + e.get("hasFemale", False):
            e["label"] = ""
        if not e["notes"]:
            del e["notes"]
        if not e.get("hasFemale"):
            e.pop("hasFemale", None)

    data = {
        "source": "Bulbapedia — List of Pokémon by availability; sprites from PokeAPI",
        "spriteBase": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/",
        "games": [{"code": c, "name": n, "gen": g, "color": col} for c, n, g, col in GAMES],
        "entries": entries,
    }
    out = ROOT / "data.js"
    out.write_text("window.DEX = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf8")

    cats = defaultdict(int)
    for e in entries:
        cats[e["cat"]] += 1
    print(f"species: {len(names)}  entries: {len(entries)}  by category: {dict(cats)}")
    print(f"no sprite: {[e['id'] for e in entries if e['sprite'] is None]}")
    if unmatched:
        print("Bulbapedia forms without PokeAPI match:", unmatched)


if __name__ == "__main__":
    main()
