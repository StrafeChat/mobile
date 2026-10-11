/**
 * The web client reads build-time settings from Vite's `import.meta.env` (VITE_API_URL,
 * DEV, ...). Hermes cannot parse `import.meta`, and the values mean nothing in an app that
 * picks its instance at sign-in, so every `import.meta.env` becomes `globalThis.__STRAFE_ENV__`,
 * an object the shims define (DEV/PROD/MODE and nothing else). Applied to web/ sources only.
 */
module.exports = function importMetaEnv({ types: t }) {
  const target = () =>
    t.logicalExpression(
      '||',
      t.memberExpression(t.identifier('globalThis'), t.identifier('__STRAFE_ENV__')),
      t.objectExpression([]),
    );
  return {
    name: 'strafe-import-meta-env',
    visitor: {
      MemberExpression(path) {
        const { node } = path;
        if (
          t.isMetaProperty(node.object) &&
          node.object.meta.name === 'import' &&
          node.object.property.name === 'meta' &&
          t.isIdentifier(node.property, { name: 'env' }) &&
          !node.computed
        ) {
          path.replaceWith(t.parenthesizedExpression(target()));
        }
      },
    },
  };
};
