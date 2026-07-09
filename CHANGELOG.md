# Changelog

All notable changes to this project are documented here.
This file is generated from [Conventional Commits](https://www.conventionalcommits.org)
by [git-cliff](https://git-cliff.org).

## [0.7.0] - 2026-07-09

### Features

- Add a button in the targets search results to see the trajectories ([9ee6d1f](https://github.com/gweybrec/my-astro-sky/commit/9ee6d1f8e26780e213280899d16c07a81aa5f829))

- Add multiple stars to plans and targets ([817a7eb](https://github.com/gweybrec/my-astro-sky/commit/817a7eb0de61a2ed1744f4f95e6dbe4db4201632))

- Ability to add obervations windows to the plans ([4997029](https://github.com/gweybrec/my-astro-sky/commit/4997029e056acd1ce5f0e101a6c0431438272f13))

- Add a sort by dropdown in the plans ([ad3bd1c](https://github.com/gweybrec/my-astro-sky/commit/ad3bd1c99e0dbf5c097f14359a180c3d6a5937c9))

- Add time window to target search ([430a7ea](https://github.com/gweybrec/my-astro-sky/commit/430a7eae31cfeaec2eeda1894d44a9593090e3cd))

- Add F3 shortcut to search DSO/Stars ([a8db433](https://github.com/gweybrec/my-astro-sky/commit/a8db43318dcced103328af4b62df81b9f38e916e))

- Add altitude value to DSO and stars tooltip when a date is selected" ([4b89425](https://github.com/gweybrec/my-astro-sky/commit/4b894259b576743a8cacac521b3db6a362d121ce))

- Add date selection and sky navigation features to map ([3bc09c6](https://github.com/gweybrec/my-astro-sky/commit/3bc09c65053ed733d52baf6b1d47c2deeb8c5ee9))


### Bug Fixes

- Star/dso density too crowded towards the center of the sky ([a384e58](https://github.com/gweybrec/my-astro-sky/commit/a384e58b7c64605f38fb3ec3bb8fe34c63b25bc8))

- Tooltips showing oustide the edge of the map ([01f20d0](https://github.com/gweybrec/my-astro-sky/commit/01f20d0fbf515a41504b3286f5a31a40446c65e4))


### Performance

- Fix fps drop when zooming out massively ([cbc68c7](https://github.com/gweybrec/my-astro-sky/commit/cbc68c7b0654c39c6dad137bd867c20022d9bb00))


### Refactor

- Rework the UX to access targets and make plans more easily accessible ([ca065d2](https://github.com/gweybrec/my-astro-sky/commit/ca065d29af7d46e69ea8de977cf1ac87e52a9517))

- Align icon buttons colors ([7bdfcab](https://github.com/gweybrec/my-astro-sky/commit/7bdfcab3e12f2a24baf65eb8f19f98ed094ac269))


### Documentation

- Rework the UI guidelines of the app ([11447dd](https://github.com/gweybrec/my-astro-sky/commit/11447ddc8c5a8ed3267dd4628b06d50cb6960e49))


### Build System

- V0.7.0 ([ed88d3b](https://github.com/gweybrec/my-astro-sky/commit/ed88d3b0eff8d7e4f3a598f2d6813177a38e113c))


### Other

- Restore DSO natural uneven distribution ([ecbf046](https://github.com/gweybrec/my-astro-sky/commit/ecbf0465b2e4b478193b01ade349179680974bfe))

- Opened plan stay opened after the targets menu closes ([7703d05](https://github.com/gweybrec/my-astro-sky/commit/7703d054e1de9b45c41e832233d8c9669ef9c0e9))

- Fix plan pdf export ([d79a179](https://github.com/gweybrec/my-astro-sky/commit/d79a1795e6dedb95f3ddc626cd535d4bcb95c199))

- Plan observation window ([d9d7ec8](https://github.com/gweybrec/my-astro-sky/commit/d9d7ec88dc89aa144d904ecd875e4964f9fa4d4d))

- Fix photo culling after changing multiple projections ([1294149](https://github.com/gweybrec/my-astro-sky/commit/1294149041c4ac83f6280a0df6fc14cd94cace99))

- Draw constellation line parts when one of the stars if outside the edge ([a857c80](https://github.com/gweybrec/my-astro-sky/commit/a857c8054b830199b54aacd8b7fd211b44f4ff9b))

- Fix local sky projection orientation ([c2808d0](https://github.com/gweybrec/my-astro-sky/commit/c2808d09e70e5700abaec55a02ebac448f0f659e))

- Fix a few DSO ([0f6b146](https://github.com/gweybrec/my-astro-sky/commit/0f6b146cbff139707e64a047a1c327086106e9db))

- Fix local sky constellation line draw beow the horizonÃ ([05f7a22](https://github.com/gweybrec/my-astro-sky/commit/05f7a2206d1a362c3b02e7c0098c3bd05e293d91))

- Fix tooltip dismissing every tick on local date projection ([f42f200](https://github.com/gweybrec/my-astro-sky/commit/f42f200c8e7802fb635febb7021d391c5836749c))

- Improve the time management for local sky ([2f6f387](https://github.com/gweybrec/my-astro-sky/commit/2f6f387ea9fbd9cc943056e6b3e93f64e5af9374))

## [0.6.0] - 2026-07-03

### Features

- Better UX to add a DSO frame from the DSO tooltip ([ca60b12](https://github.com/gweybrec/my-astro-sky/commit/ca60b12509188515b35e4422cb92357d86d4852a))

- Add a performance section in the sky panel ([f2cc752](https://github.com/gweybrec/my-astro-sky/commit/f2cc752ee71472bbeabe9d6064025fad0a30c711))

- Allow adding mosaics in free mode and allow moving frames from free mode into a plan ([6e75cd8](https://github.com/gweybrec/my-astro-sky/commit/6e75cd8e77d5c16bfded1cfe6ac3793b058c81f3))

- Allow clicking in sky tootips ([d815aec](https://github.com/gweybrec/my-astro-sky/commit/d815aec616eb25e0999ed2b6ed005806de4e152a))

- Sky map redesign ([c725951](https://github.com/gweybrec/my-astro-sky/commit/c725951ac2f20d14907ec54ca39f12e46636bfe0))

- Add points of interest metadata in photos ([e95e160](https://github.com/gweybrec/my-astro-sky/commit/e95e160e14e511abea756f6933c13510e114fda7))

- Add a fisheye mode ([f2c33d0](https://github.com/gweybrec/my-astro-sky/commit/f2c33d0ab8ec1f3f9410126fae6500aedc70b3e5))


### Improvements

- Dismiss sky tooltip on mouse wheel events ([e79b3f8](https://github.com/gweybrec/my-astro-sky/commit/e79b3f843297ad3a90940c4c6df5010962ed0c04))

- Make dimmer stars smaller ([5c5ae43](https://github.com/gweybrec/my-astro-sky/commit/5c5ae4309619df7a808c98006b24b335637acc76))


### Bug Fixes

- Still some DSO incorrect data ([788b586](https://github.com/gweybrec/my-astro-sky/commit/788b586c3d90a71ba84a41ca3b7bb4dc875cfd9f))

- Some DSO duplications and designations mess ([6ae82d6](https://github.com/gweybrec/my-astro-sky/commit/6ae82d6d40468d797eddd5ccf5bf134d083a3f2c))

- App update popup design ([1aaf67f](https://github.com/gweybrec/my-astro-sky/commit/1aaf67fd2267fe76feb47db4470a9ead76bcd3ab))


### Performance

- Viewport-cull DSO selection via a spatial index ([c137173](https://github.com/gweybrec/my-astro-sky/commit/c13717319805dcfb538a25a51a4f6e6dd1fdceff))

- Refresh the star sprite atlas on zoom drift to avoid pixelation ([7b81474](https://github.com/gweybrec/my-astro-sky/commit/7b8147488de365cb42137c0f08d81b2b735aa90d))

- Stop rebuilding the star sprite atlas every zoom frame ([7aafed2](https://github.com/gweybrec/my-astro-sky/commit/7aafed24d864c086155d014588e6cb33375eaa51))

- Cache projections, star sprites, and DSO size factors in sky render ([49d7903](https://github.com/gweybrec/my-astro-sky/commit/49d79035fa3db28294e7e1f6a665bc8caabec389))


### Refactor

- Review the DSO type/magnitude/designations ([79bc095](https://github.com/gweybrec/my-astro-sky/commit/79bc0955364d22760de95049ae21b6a278811923))

- Gallery filter dropdowns behavior ([c0b37a6](https://github.com/gweybrec/my-astro-sky/commit/c0b37a67fc9492742d0ae9b305a4edc7f8c45160))

- Stars/DSO display bugdet using a PAN invariant ([6594f6b](https://github.com/gweybrec/my-astro-sky/commit/6594f6bd9ab93f585941bc5caf069b56ab0bc5d8))

- Drawing priority for the DSOs ([cc483c3](https://github.com/gweybrec/my-astro-sky/commit/cc483c3d181886edb92442b4e1a7f913de648d0b))

- Backup restore ([173babb](https://github.com/gweybrec/my-astro-sky/commit/173babbb5970657ad8f5624d5a3338da15f2f5e4))

- Improve the UX of adding/editing/deleting gear setups ([7703e64](https://github.com/gweybrec/my-astro-sky/commit/7703e64aa144ba1f8ddb7d978805ee165a9b1316))

- Remove stars.8.json and keep only stars.14.json ([0dc964d](https://github.com/gweybrec/my-astro-sky/commit/0dc964d292900ad14ea2210d548ab0cfbe5f128c))


### Documentation

- Improve the Github pages ([3bcd8fe](https://github.com/gweybrec/my-astro-sky/commit/3bcd8fec5f0d512ada8dd2cc0dd259c3fe2f6059))


### Build System

- V0.6.0 ([105d085](https://github.com/gweybrec/my-astro-sky/commit/105d085d35db9fc18a554a59d7698cabadbd978f))

- Slightly update the app icon ([01527d3](https://github.com/gweybrec/my-astro-sky/commit/01527d31e3db0292ae82ad498acc44289708b81c))


### Other

- Fix vue-tsc failures ([0690e09](https://github.com/gweybrec/my-astro-sky/commit/0690e09fab8312f808f5f7d8985711a8eff70eb8))

- Extract FOV frame drawing into frame-draw and tokenize ([5892dfe](https://github.com/gweybrec/my-astro-sky/commit/5892dfe9a44f6adae904e955489788d673d34aae))

- Extract star painters and DSO label logic ([d55dd66](https://github.com/gweybrec/my-astro-sky/commit/d55dd66bac4225240d55bd07d9b7ba40767cb36a))

- Extract table-driven DSO marker painter into dso-draw ([7a3a872](https://github.com/gweybrec/my-astro-sky/commit/7a3a872e8454788950879edb0f6452d552abd406))

- Add canvas-theme tokens for sky-map render colors and sizes ([34ff2c3](https://github.com/gweybrec/my-astro-sky/commit/34ff2c37dea1932950199839d59ee4377bd26f71))

- Move self-contained draw layers into sky-draw ([2ebdf60](https://github.com/gweybrec/my-astro-sky/commit/2ebdf602c97be203c112aaed62c38cede1396f07))

- Wire sky-map to the extracted modules ([41b1da6](https://github.com/gweybrec/my-astro-sky/commit/41b1da6e6c8495a09157bf24055195a2d633b21f))

- Extract DSO hover hit-test into hover-hit-test ([4a380db](https://github.com/gweybrec/my-astro-sky/commit/4a380db06c7fc55eef15a46418761b1f35aeaf34))

- Extract camera maths into sky-view-math ([35a7778](https://github.com/gweybrec/my-astro-sky/commit/35a7778efc603623c847a710b4be90a10644408e))

- Extract frame merge/resize decisions into frame-interaction ([ba74479](https://github.com/gweybrec/my-astro-sky/commit/ba74479505f012195fbafbd9333337cd80319a84))

- Extract frame canvas geometry into frame-geometry ([2bc231c](https://github.com/gweybrec/my-astro-sky/commit/2bc231c7b0fa0a81fb3d77ec588f9b866b2a09c4))

- Extract adaptive-LOD state machine into interaction-lod ([c6abbaf](https://github.com/gweybrec/my-astro-sky/commit/c6abbaf55b38bc4c1e104fa880a9bd04a6b8c915))

- Extract photo-outline geometry from sky-map ([62b306f](https://github.com/gweybrec/my-astro-sky/commit/62b306f884dccd60692fc50f6daba733e9cc1660))

- Extract DSO render maths into dso-render-math ([e35e3e4](https://github.com/gweybrec/my-astro-sky/commit/e35e3e4868d8538513d69fa59fe7fa1d3f507d8c))

- Extract star render maths into star-render-math ([999fe2e](https://github.com/gweybrec/my-astro-sky/commit/999fe2e9216c43fa7f485fec9c2108c0cd0fe2a5))

- Remove unused field ([4e80b2a](https://github.com/gweybrec/my-astro-sky/commit/4e80b2a9d05164c136153ef7f5ce9ed256c19363))

- Make the zoom look smoother by redrawing more often stars with a glow ([59e9e66](https://github.com/gweybrec/my-astro-sky/commit/59e9e6660f07cdf4124ca8ee4822b81119818554))

- Extract and reuse the eye toggle icon ([b0f0d56](https://github.com/gweybrec/my-astro-sky/commit/b0f0d56394396eda7c9124d17ae5bc7422295aaf))

- Improve POI chip creation ([d4e755d](https://github.com/gweybrec/my-astro-sky/commit/d4e755d6f7f081fc8a8fbf8efa5e2ea5a7e8a2b7))

## [0.5.0] - 2026-06-22

### Features

- Moon awareness in plans ([108e2e3](https://github.com/gweybrec/my-astro-sky/commit/108e2e35eeda93d3ab27fa73c1c9e85f8be49493))

- Add keyboard shortcuts ([421408a](https://github.com/gweybrec/my-astro-sky/commit/421408a45c8b0481187a5a6ac49e737c54979e96))

- Add a "cancel all solving" button when adding photos ([27ecd80](https://github.com/gweybrec/my-astro-sky/commit/27ecd808539d0bd06a0d64d50e382fd473ea7a23))


### Bug Fixes

- Only validate dimensions for the full-resolution image ([40407a6](https://github.com/gweybrec/my-astro-sky/commit/40407a670bef545737122928ce1a88b8223f9157))

- Missing the ability to restoreplans from a backup ([6579f3b](https://github.com/gweybrec/my-astro-sky/commit/6579f3b2a65e2fdfda9701424f379f63fe6cfb55))

## [0.4.0] - 2026-06-22

### Features

- Allow adding more photos withing the "add photos" menu ([184eb95](https://github.com/gweybrec/my-astro-sky/commit/184eb953d864a3bf2835356099f3170c94909ba5))

- Add Barnard catalog ([56d245b](https://github.com/gweybrec/my-astro-sky/commit/56d245bcf0a7a730e04d35d931c529baddbd550b))

- Add the ability to create mosaic frames (PR #1) ([1fbdc28](https://github.com/gweybrec/my-astro-sky/commit/1fbdc281c897d83a16ee69166884196c04a91b5d))

- Allow adding new targets to plan from the sky map ([d0162d5](https://github.com/gweybrec/my-astro-sky/commit/d0162d5813383a5b06ba93a6486a98d0aee434a8))


### Bug Fixes

- DSO searching when identical names differed by just a space ([9c1aa8f](https://github.com/gweybrec/my-astro-sky/commit/9c1aa8fd662e5511e7fdee9f2430ed1f9bb9557b))

- Searching DSO with characters like dots ([b70ea6f](https://github.com/gweybrec/my-astro-sky/commit/b70ea6f64f24c7c8d1c46f4972166eb7b4ea82b4))

- Rating system for well known targets ([3492a10](https://github.com/gweybrec/my-astro-sky/commit/3492a10c4e0e4360bb97b9452691a0ebb68ae843))

- Many DSO issues, mostly for vdB and SH2 entries ([7c53899](https://github.com/gweybrec/my-astro-sky/commit/7c5389912d375d9ba47a855ac5677742eeffc483))

- Dropdown list scroll tracking ([646ac19](https://github.com/gweybrec/my-astro-sky/commit/646ac198554565aa4e1f860ed47d67ab98ef9a0f))

- Showing/hiding photos by label ([fbb9ec2](https://github.com/gweybrec/my-astro-sky/commit/fbb9ec2ad925caf9d6ac2c1af11d16f901ab0f7e))

- Draw plan frames on top of photos ([0cd1cac](https://github.com/gweybrec/my-astro-sky/commit/0cd1cac24f4a103c309c869db4d55a84d58a80d5))


### Documentation

- Add documentation for the plans ([dc23100](https://github.com/gweybrec/my-astro-sky/commit/dc2310052082399044a4120a9b9fc0f3369e1b56))


### Other

- Smart scopes mosaics + small UI/UX improvements ([e9ec034](https://github.com/gweybrec/my-astro-sky/commit/e9ec034901001e1a77031511b273965fa9484e82))

- Mosaic phase 3 ([746e1b4](https://github.com/gweybrec/my-astro-sky/commit/746e1b4705b934fcbc356e5e494f39799ba1ade9))

- Mosaic phase 2 ([86234d8](https://github.com/gweybrec/my-astro-sky/commit/86234d8fc396a1c5f4636fe1c97823f461c1017d))

- Mosaic phase 1 ([0f465cf](https://github.com/gweybrec/my-astro-sky/commit/0f465cff8cc31557f45443f88a3b70ec1e9e413a))

## [0.3.0] - 2026-06-17

### Features

- View a plan on the sky by displaying its frames ([1d9871c](https://github.com/gweybrec/my-astro-sky/commit/1d9871cb4cddc81f0c8ec9f6514a28bfd21a6ff9))

## [0.2.0] - 2026-06-16

### Features

- Add plans ([b6f4f5e](https://github.com/gweybrec/my-astro-sky/commit/b6f4f5e74dca3dbf2c272a044c89ae9c4b20374c))

- Export map as png or pdf and the gallery as pdf ([dce62e3](https://github.com/gweybrec/my-astro-sky/commit/dce62e3177dc38386099bafb52f4535a9307d141))


### Bug Fixes

- Various small UI issues ([197abc0](https://github.com/gweybrec/my-astro-sky/commit/197abc00d04305f4aa9e8041cef8c9ab13613010))

- ASTAP plate solver ([8736b98](https://github.com/gweybrec/my-astro-sky/commit/8736b98ddfbf758c7cbff5b825c2bb66b87f76f0))


### Refactor

- Unified UI/UX for adding one or mutiple photos ([0a28d59](https://github.com/gweybrec/my-astro-sky/commit/0a28d59f7571056a1ddfef54d845b313e73a9394))

## [0.1.0] - 2026-06-13

### Refactor

- Complete rewriting of the app and tons of new features ([e3a6f9e](https://github.com/gweybrec/my-astro-sky/commit/e3a6f9e7935607484c0c6c877ec8b932938d6676))


