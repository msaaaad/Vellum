/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-no-framework-deps',
      comment:
        'packages/core is the trust-critical, framework-agnostic piece (hashing, canonicalization, ' +
        'verification). It must stay independently reviewable/testable, so it may not depend on ' +
        'NestJS or HTTP frameworks.',
      severity: 'error',
      from: { path: '^packages/core' },
      to: {
        path: 'node_modules/(@nestjs|express|fastify|koa|next)/',
      },
    },
    {
      name: 'core-no-sibling-packages',
      comment:
        'packages/core must not depend on any other Vellum package — it is the dependency root, ' +
        'so a cycle back into nestjs/cli/storage-pg would break independent testability.',
      severity: 'error',
      from: { path: '^packages/core' },
      to: { path: '^packages/(nestjs|cli|storage-pg)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
