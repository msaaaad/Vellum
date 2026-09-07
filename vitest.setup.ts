// NestJS decorators (@Injectable, @Inject, @SetMetadata, ...) call into `Reflect.defineMetadata`
// at class-definition time, which only exists once this polyfill has loaded. Real apps get it for
// free (Nest's own bootstrap imports it), but the test runner needs it loaded before any
// `packages/nestjs` module is imported — hence one global setup file for the whole workspace.
import 'reflect-metadata';
