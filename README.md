# StoryProgressExtended

StoryProgressExtended is a starter SillyTavern UI extension scaffold for future story progress tracking features.

## Status

This repository currently contains the beginning structure only:

- SillyTavern extension manifest
- Vanilla JavaScript entrypoint
- Namespaced stylesheet
- GitHub issue and pull request templates
- Basic validation workflow

No visible UI or story progress logic has been implemented yet.

## Installation

1. Place this folder in your SillyTavern third-party extensions directory.
2. Restart or reload SillyTavern.
3. Open **Extensions** and confirm `Story Progress Extended` appears in the extension manager.

For local development, SillyTavern recommends placing third-party extension repositories in:

```text
public/scripts/extensions/third-party/
```

Depending on your installation, user-scoped extensions may also be stored under:

```text
data/<user-handle>/extensions/
```

## Development

The extension entrypoint is `index.js`. The initial lifecycle hook is configured in `manifest.json`:

```json
{
  "hooks": {
    "activate": "onActivate"
  }
}
```

Open the browser developer console after loading SillyTavern to confirm the activation log appears without runtime errors.

## License

MIT
