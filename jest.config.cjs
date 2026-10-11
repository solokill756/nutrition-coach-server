/** Jest for the NestJS sources; the `test` script expects this file. */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: "\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
};
