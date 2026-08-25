export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'chore', 'docs', 'test', 'style', 'ci', 'build', 'revert']],
    'subject-case': [0],
  },
}
