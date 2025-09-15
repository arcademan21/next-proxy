module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/test/**/*.ts", "**/test/**/*.js"],
  moduleFileExtensions: ["ts", "js", "json"],
  globals: {
    "ts-jest": {
      tsconfig: "tsconfig.json",
    },
  },
  // Opcional: Ignora el directorio dist y node_modules
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
