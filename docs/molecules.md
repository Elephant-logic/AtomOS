# Atoms and molecules

Atomic Core remains the deterministic execution layer. The molecular layer is the higher-level authoring model for people and AI.

```text
Human / AI intent
      ↓
Application graph
      ↓
Molecules and typed bonds
      ↓
Atoms
      ↓ compile
Atomic entities + rules + events
      ↓
Atomic Core
```

An **atom** is a small tested capability with typed inputs and outputs. A **molecule** is a set of atom instances joined by compatible bonds. The compiler namespaces every instance, emits ordinary Atomic entities and rules, and stores a source map so the debugger can translate low-level rule activity back into atoms and bonds.

The tiny Atomic language is kept as the stable intermediate representation. This preserves deterministic replay, validation, journaling and plugins while making application construction less fragile.

## Initial proof

The repository includes button, text-display and string-state atoms plus a Counter Molecule. Run `npm test` to verify connector typing, namespacing and source-map generation.

## Planned Studio integration

- Application → Molecule → Atom → Compiled Atomic zoom levels
- drag-to-bond typed connectors
- bond activity mapped from the journal
- AI operations such as `add_molecule`, `connect`, `configure` and `create_atom`
- versioned atom/molecule library
- navigation, forms, API, storage, authentication and plugin atoms
