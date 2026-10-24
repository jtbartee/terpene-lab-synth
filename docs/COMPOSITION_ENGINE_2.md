# Composition engine 2 — audit, design and research

Version 0.2.0, 2026-10-23. Code: `src/music/` (`composer.ts`, `arrangement.ts`, `groove.ts`, `bass.ts`, `melody.ts`, `grid.ts`, `analysis.ts`, `demos.ts`).

## 1. The problem

Owner feedback on v0.1: synth sounds, arpeggio tones and the odd melody changed between generations, but the rhythms, repeating patterns and overall structure stayed the same. Pieces sounded like variations of one backing track.

## 2. Audit of the v0.1 engine

The v0.1 engine is kept unchanged in `tests/music/legacy/composer-v1.ts` as the baseline for the diversity tests.

| Area | What v0.1 did | Why it sounded the same |
|---|---|---|
| Drums (`genDrums`) | One fixed template per kit. Motorik: kick on group starts plus a push at step 10, snare on the backbeats, eighth hats. | Every seed in a style had the same kick, snare and hat positions. The only randomness was **per-bar** chance on sixteenth hats and ghosts. That is noise, not a groove, and it is never repeated, so it creates neither identity nor variety. |
| Bass (`makeBassMotif`) | Motorik: always eight eighth notes. Dub: a hit on 1 plus one of three positions. Berlin: sixteen sixteenths. Walking: quarters. | The **rhythm** was fixed per style. The seed chose only pitches (root, third, fifth, octave). Measured across seeds, Motorik, Berlin, Krautpop, Kosmische and Ambient bass rhythms were **identical** (dissimilarity 0.00). |
| Bass mutation (`mutateBass`) | Replaced one note's chord tone. | Changed pitch only, never rhythm, length or accent. |
| Arpeggio | Euclidean rhythm plus a random walk of pool indices. Mutation: ±1 on one index, toggle one slot, or swap the order. | No phrases, rests, hooks, call and response or return. An endless traversal of chord tones. |
| Sections | 16-bar blocks named after an energy sine wave (`Section A…F`, `Breakdown` when energy < 0.4). | Sections had no material of their own. "B" differed from "A" only in which layers happened to be on. |
| Development (`develop`) | One weighted pool of events every 8 bars. Most were timbral: filter, timbre, pan, register, inversion. | The same small set of changes, forever, regardless of where the piece was. No idea of building, contrasting, breaking down or returning. |
| Memory | `bassOriginal` and `arpOriginal`, used only for "return to original". | Nothing else was remembered: no main groove, no contrasting motif, no section history. |
| Seed | Harmony path, bass pitches, arp motif, perc cycle and the phase of the energy wave. | Did not influence groove, bass rhythm, form, phrase length, section contrast or transitions. |
| Phrases and sections | Always 8 and 16 bars. | Every piece breathed at the same rate. |

Scheduling, seeded randomness, live and offline equivalence, harmony voice leading and the chemical-to-musical mapping were sound, and are kept.

## 3. Design

### 3.1 Planning before playing

Before the first note, `Composer.init()` builds:

1. **A phrase length** (4, 8 or 16 bars), weighted per style and seeded.
2. **An arrangement blueprint** (`arrangement.ts`). Each section has a role, a length in eight-bar blocks, an energy trajectory, the **material** it uses (groove, bass, melody), harmonic behaviour (home, away or move), a development mode and a transition. The seven blueprints are:

   | Blueprint | Sections | Main styles |
   |---|---|---|
   | Hypnotic evolution | Intro → A → A1 → A2 → Breakdown → A3 → Expansion → Return → Outro | Motorik, Microhouse, Dub |
   | Two-part exploration | Intro → A → B → A′ → B′ → Outro | Krautpop, Motorik |
   | Berlin-school development | Sequence introduction → Pattern expansion → Harmonic transition → Secondary sequence → Layered peak → Resolution | Berlin |
   | Dub techno journey | Atmosphere → Groove establishment → Chord development → Percussion breakdown → Dub return → Dissolution | Dub, Microhouse |
   | Ambient drift | Sparse introduction → First harmonic field → Texture transformation → New harmonic field → Return of the theme → Gradual dissolution | Ambient, Drone, Kosmische |
   | Krautrock jam | Primary groove → Motif development → Contrasting section → Extended improvisation → Original groove → Fade | Motorik, Krautpop |
   | Additive process | Pulse → Additive build → Full process → Subtraction → Return → Outro | Berlin, Motorik, Microhouse |

   Lengths, optional sections (a "contrast echo" at high Structure) and the choice itself vary with the seed. Finite arrangements are fitted to the requested length by dropping low-priority sections first.
3. **A material bank, the musical memory.** It holds:
   - a main groove and a contrasting groove;
   - a main and a contrasting bass motif;
   - a primary and a secondary melodic motif, chosen to contrast in kind, density or register;
   - main and contrasting chord-stab rhythms and pad modes;
   - harmonic loops for home and away.

   It also records the developed forms of each motif, the distance travelled from the original, sections visited and a development log.

### 3.2 Grooves (`groove.ts`)

Each kit has a family of archetypes. All keep the style's identity: Motorik keeps a kick on one and a driving eighth pulse, and Dub Techno and Microhouse keep four on the floor.

| Kit | Archetypes |
|---|---|
| Motorik | straight driving, sparse, syncopated, half-time atmospheric, bass-driven, percussion-heavy, minimal pulse |
| Krautpop | motorik + tambourine, lounge bossa (son clave), four-on-the-floor vamp, shuffled, half-time |
| Dub | classic (open off-beat hat), deep minimal, shuffled shaker, steppers with rim shots, stripped, rolling 3-3-2, hand percussion |
| Berlin | sequencer pulse, Euclidean tom pulse, driving electronic, three-against-four accents, minimal shaker |
| Pulse (Kosmische) | heartbeat, slow half-bar, brushed sixteenths, distant tom |
| Micro | clicky, shuffled, skippy kick, bare minimal, cut-up off-grid |

- A groove is a **one- or two-bar cycle** of hits. Each hit has a position, velocity, kind (core, detail or ghost), a fixed threshold, length and micro-timing. Detail and ghost hits sit at **fixed seeded positions**: raising Rhythmic detail fills in the same places, so a groove grows denser without losing its shape.
- Each groove carries a feel (swing, per-voice lay-back), a fill style (snare roll, open hat, kick drop, stutter, tom run, clap flam) and an optional Euclidean percussion line.
- **Variation operators** make related grooves: thin, busier, accents displaced, new kick placement, open hat moves, half-time, add a percussion line, two-bar answer. Sections ask for `main`, `var`, `busy`, `thin`, `half`, `contrast` or `contrastVar`. Phrase-level development applies one operator at a time and settles back to the section's groove.
- **Groove diversity** reshapes the archetype prior: 0 uses only the canonical archetype; 1 flattens the family.

### 3.3 Bass (`bass.ts`)

- A motif has independent parts: onsets and lengths, pitches, accents, gate (articulation), register via octaves, and a cycle of one to four bars. Pitches are chord tones plus scale steps, resolved against the current chord at play time. Harmonic movement is handled by an approach note into the next chord.
- **Archetypes:**
  - eighth-note ostinato and sixteenth sequence (with step-sequencer rests and ties, and cells of 3–8 notes that phase against the bar);
  - galloping sequence, syncopated (fixed templates plus Euclidean placements) and off-beat (seven variants);
  - sustained notes with gaps, root–octave pulse and repeated-note rhythm;
  - melodic phrase (walking), call-and-response and pedal drone.
- Each style has its own weighted family. The choice also **interlocks with the groove**: a four-on-the-floor kick favours off-beat and syncopated bass, a sparse kick favours ostinatos, and syncopated templates avoid the kick's off-beat placements.
- **Mutations:**
  - small: shift an onset, lengthen or shorten a note, open a rest, add a pickup, move the accent;
  - large: two-bar rhythmic answer, replace the phrase ending, turn the contour (pitch retrograde or inversion), grow a new related motif;
  - held notes for breakdowns.

  Motif evolution moves the weight from small to large mutations.

### 3.4 Melody (`melody.ts`)

- **Arpeggio figures:**
  - a rhythm: sixteenths, eighths, 3+3+2, gallop, pairs, off-beat, dotted eighths, Euclidean or quarters, with fixed rests;
  - a contour cell of 3–8 notes: rising, falling, rise-and-fall, pendulum, pedal point, broken thirds, skipping or sequenced cell.

  The cell length can differ from the rhythm's length, so the figure phases across bars, as in Berlin-school sequencing.
- **Melodic hooks** are built as:
  - a riff;
  - **call and response**: the call ends open, the answer resolves to the chord root;
  - a **sentence**: basic idea, its repetition (often sequenced), fragmentation, then a cadence;
  - a **period**: an antecedent ending on the fifth, then a consequent ending on the root.

  Contours are arch, descent, ascent, valley, neighbour, or leap and fill. Ambient uses a slow constellation phrase: long tones, a call in the low register and an answer a fifth higher.
- **Pitch handling:**
  - Degrees are relative, so a motif follows the harmony.
  - Strong-beat and long notes snap to chord tones, in the direction the line is moving, so the contour survives the snap.
  - Every note stays in the selected scale (tested for 8 styles × 11 scales).
- **Transformations:** sequence (transposition), inversion, retrograde, register change, augmentation, fragmentation, rhythmic displacement, extension, rests, embellishment with passing notes, and rhythmic variation. **Gradual transformation** (`morphMotif`) replaces a motif with new material a quarter of the cycle per phrase.
- **Rests are compositional:** a melody can rest for a phrase and come back.
- **Two motifs can answer each other:** the primary plays in the first half of a phrase and the secondary in the second.

### 3.5 Development by section

At a **section start** the composer switches material, harmony program, pad mode and arrangement. Up to four layers can change at once at the musically big moments (breakdown, return, peak, contrast, the first main section); otherwise two. The rest are queued, one per phrase. The development log records the material changes.

At a **phrase start inside a section**, it makes 0–3 decisions (Variation sets how many; Transition smoothness reduces it). Their kind depends on the section:

| Mode | Used by | Decisions |
|---|---|---|
| restrain | A sections | rare groove accents or open hats, a small bass or melody change, inversions, filters |
| develop | A1–A3, peaks, jams | groove operators, bass mutations, motif transformations, a second motif answers, gradual morph, layers in and out |
| contrast | B sections | develop the secondary material |
| strip | breakdowns | remove layers, close filters, let the melody rest |
| build | builds, intros | busier rhythm, filters open, layers enter; drums build from the hats up |
| restate | returns | almost nothing: the original material speaks |
| dissolve | outros | one layer leaves per phrase, sustained layers last |

- **Returns:** a motif that has moved more than `1 + 5 × Motif evolution` steps from its original is brought back. Return sections always use the original groove, bass and motif.
- **Transitions** at the end of a section are fills, drops (kick and snare silent for the last two beats), builds (a two-beat snare roll) or cuts (a one-beat hole before the next section).
- **Breakdowns** lose the kick and lower the bass (60 %) and drone (80 %), because held bass notes otherwise carry as much low end as the line they replace (measured on the rendered demos).

### 3.6 Endless pieces

When the plan runs out, a new **cycle** is planned, with a new or repeated blueprint and no intro or outro. Each cycle:

- keeps the identity: the primary motif and the original groove;
- may adopt a related main groove and bass;
- makes a new secondary motif;
- moves the developed primary motif to a related form (sequence, inversion, retrograde or displacement);
- can morph the old secondary motif into the new one;
- always contains a section that **returns the original material**.

### 3.7 What the seed now controls

Groove archetype, bass archetype and rhythm, melodic motifs, blueprint, phrase length, section lengths and optional sections, contrast material, harmonic loops, stab rhythms, development decisions and transitions. Identical seeds and inputs give byte-identical plans: motif ids are content hashes, and a test compares whole BarPlans.

### 3.8 Analytical mode

Analytical sonification holds compositional targets neutral and uses no profile variant, so every profile plays one identical reference composition (tested: identical JSON of 128 bars for two profiles in three styles). Structural diversity comes from the seed. In Generative mode the profile variant is folded into the seed, so each profile also gets its own structure.

### 3.9 Controls

The existing controls keep their meaning, and are now clearly separate:

- **Complexity:** detail inside patterns.
- **Density:** how many layers and notes.
- **Variation:** how many small decisions per phrase.

There are three new knobs:

| Control | Plan-level effect (next Play or Regenerate) | Live effect |
|---|---|---|
| Groove diversity | archetype breadth for grooves and bass; whether contrast sections get their own groove | weight of groove operators |
| Structure | blueprint choice (hypnotic ↔ contrast-rich), contrast-echo sections, contrasting bass, pulsing pads in B sections | weight of answering motifs |
| Motif evolution | how far motifs may travel, chance of related new material per endless cycle | small vs large transformations, return threshold |

### 3.10 Saved compositions

Presets now record `engine: 2`. Presets saved by 0.1 load with defaults for the new controls, and a notice says that engine 2 composes a different piece from the same settings (determinism holds per engine version). The schema stays `preset@1`, because the new fields are optional.

## 4. Research behind the design

These are traits the rules emulate. No recordings, transcriptions or melodies are copied.

**Verified online for this release (2026-10-23):**

- **Witek, Clarke, Wallentin, Kringelbach & Vuust (2014),** "Syncopation, body-movement and pleasure in groove music", *PLoS ONE* 9(4): e94446 ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4581707)).
  - Finding: medium syncopation gave the strongest wish to move and the most pleasure (an inverted U).
  - Effect on the design: syncopation lives in fixed, moderate kick and bass placements; offbeat detail is gated by thresholds instead of random per-bar hits.
- **von Hippel & Huron (2000),** "Why do skips precede reversals? The effect of tessitura on melodic structure", *Music Perception* 18(1).
  - Finding: they show that a reversal after a leap is largely explained by range (a leap tends to land near the edge of the tessitura). It is not necessarily something listeners expect.
  - Effect on the design: the *leap and fill* contour models this observed tendency; it is not presented as a rule of good melody.
- **Caplin, W. E. (1998),** *Classical Form*, Oxford University Press ([review](https://www.mtosmt.org/issues/mto.14.20.1/mto.14.20.1.aziz.php)). The sentence (presentation of a basic idea and its repetition, then continuation with fragmentation, then cadence) and the period (antecedent, consequent) are the two basic theme types. They are the models for the `sentence` and `period` hook forms.

**Background (cited from the developer's knowledge; not re-verified online in this session because the search quota ran out):**

- Schoenberg, A. (1967), *Fundamentals of Musical Composition*, Faber: the motive and developing variation; the source of the transformation set.
- Toussaint, G. (2013), *The Geometry of Musical Rhythm*, CRC Press, and Toussaint (2005) on Euclidean rhythms (already used in v0.1): Euclidean bass and percussion placements.
- Butler, M. J. (2006), *Unlocking the Groove: Rhythm, Meter, and Musical Design in Electronic Dance Music*, Indiana University Press: layering, additive and subtractive form, breakdowns and builds in electronic dance music.
- Reich, S. (1968), "Music as a Gradual Process", in *Writings on Music 1965–2000* (Oxford University Press, 2002): the gradual morph between motifs.
- Potter, K. (2000), *Four Musical Minimalists*, Cambridge University Press: additive process (the *Additive process* blueprint).
- Veal, M. E. (2007), *Dub: Soundscapes and Shattered Songs in Jamaican Reggae*, Wesleyan University Press: dub mixing as subtraction and return; the Dub techno journey's percussion breakdown and dub return.
- Stubbs, D. (2014), *Future Days: Krautrock and the Building of Modern Germany*, Faber: motorik drumming (Klaus Dinger) and long-form jam structure.
- Margulis, E. H. (2014), *On Repeat: How Music Plays the Mind*, Oxford University Press: repetition as a source of identity, hence long-lived grooves and literal returns.

## 5. What has not been done

- **No human listening test.** The developer cannot hear the output. Everything above is checked by analysis of generated events and rendered audio. Three listening demos with a feedback form are in the app (Synth → Listening session), and rendered WAVs are produced by `npm run render:demos`.
- Style weights and thresholds are first estimates, to be tuned from the owner's listening notes.
