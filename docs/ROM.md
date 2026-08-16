# Tonolith v1 ROM and commitment layout

Tonolith v1 uses one immutable, content-addressed ROM tree per CPU instance.
The ROM is not copied into mutable execution state. Its root cell is stored in
the contract data and is bound to `staticCommitment` at deployment.

## Addressing

- 1,024 words;
- one word is 16 bits;
- a ROM address is `uint10`, `0..1023`;
- words are assembled and stored in ascending address order;
- a word is canonical only when its opcode-specific operand width is valid.

The tree is four-way at every level:

```text
RomRoot
├── level20: 16-leaf half
│   ├── level10..level13
│   │   └── leaf0..leaf3
├── level21: 16-leaf half
│   ├── level10..level13
│   │   └── leaf0..leaf3
├── level22: canonical zero subtree
└── level23: canonical zero subtree
```

There are 32 leaves. Each `RomLeaf` contains 32 words as two fixed-width
fields:

```text
firstHalf:  uint256  // words leaf*32 + 0 .. +15, big-endian within the field
secondHalf: uint256  // words leaf*32 +16 .. +31, big-endian within the field
```

The two unused root children remain canonical zero subtrees. The TypeScript
ROM builder constructs those zero subtrees independently; it must not reuse a
program-bearing level-2 node as a zero node.

