import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import parser from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import { promisify } from "util";
import { Preprocessor } from "content-tag";

const traverse = _traverse.default;
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const GJSPreprocessor = new Preprocessor();

const EXCLUDED_DIR_PATTERNS = [
  "/app/assets/javascripts/discourse/tests/unit/",
  "/discourse/tmp/",
  "node_modules",
  "/discourse/dist/",
  "/discourse/vendor/",
  "/discourse/public/",
  "/discourse/spec/",
  "/discourse/plugins/",
];
const filesToDebug = [];
const idsToInclude = ["discourse.post-stream-widget-overrides"];

async function isExcludedDir(filePath) {
  return EXCLUDED_DIR_PATTERNS.some((pattern) => filePath.includes(pattern));
}

function extractId(node, scope, ast = null) {
  if (t.isObjectExpression(node)) {
    for (const prop of node.properties) {
      if (
        t.isObjectProperty(prop) &&
        t.isIdentifier(prop.key, { name: "id" })
      ) {
        if (t.isStringLiteral(prop.value)) {
          return [prop.value.value];
        } else if (t.isIdentifier(prop.value)) {
          return resolveIdentifier(prop.value.name, scope, ast);
        }
      }
    }
  }
  return [];
}

function resolveIdentifier(name, scope, ast = null) {
  const binding = scope.getBinding(name);
  if (!binding) {
    return [];
  }

  if (t.isVariableDeclarator(binding.path.node)) {
    const init = binding.path.node.init;

    if (t.isIdentifier(init)) {
      return resolveIdentifier(init.name, binding.path.scope);
    } else if (t.isObjectExpression(init)) {
      return extractId(init, binding.path.scope);
    } else if (t.isArrayExpression(init)) {
      for (const currNode of init.elements) {
        if (t.isObjectExpression(currNode)) {
          return extractId(currNode, binding.path.scope);
        }
      }
    }
  }
  // discovery-controller-shim case
  if (t.isIdentifier(binding.path.node) && binding.kind === "param") {
    let argIndex;
    const calleeFunctionName = binding.path.findParent((p) => {
      if (p.isFunctionDeclaration()) {
        const matchingArg = p.node.params.find((p) => p.name === name);
        if (matchingArg) {
          argIndex = p.node.params.findIndex((p) => p.name === name);
          return true;
        }
      }
    })?.node?.id?.name;

    return traverseForDeprecationId(ast, name, calleeFunctionName, argIndex);
  }

  return [];
}

function traverseForDeprecationId(
  ast,
  deprecationIdName,
  calleeFunctionName,
  argIndex
) {
  const ids = [];
  if (!ast) {
    return null;
  }

  traverse(ast, {
    CallExpression(path) {
      if (t.isIdentifier(path.node.callee, { name: calleeFunctionName })) {
        const id = path.node.arguments[argIndex].value;
        if (id) {
          ids.push(id);
        }
      }
    },
  });

  return ids;
}

async function parseFile(filePath) {
  let hasDeprecatedFunction = false;
  let code = await readFile(filePath, "utf8");

  try {
    if (filePath.endsWith(".gjs")) {
      code = GJSPreprocessor.process(code);
    }

    const ast = parser.parse(code, {
      sourceType: "module",
      plugins: [["decorators", { version: "2023-11" }]],
      errorRecovery: true,
    });
    const ids = [];

    traverse(ast, {
      CallExpression(path) {
        if (t.isIdentifier(path.node.callee, { name: "deprecated" })) {
          hasDeprecatedFunction = true;
          for (const arg of path.node.arguments) {
            if (t.isObjectExpression(arg)) {
              const extractedIds = extractId(arg, path.scope, ast);
              if (extractedIds) {
                ids.push(...extractedIds);
              }
            } else if (t.isIdentifier(arg)) {
              const resolvedIds = resolveIdentifier(arg.name, path.scope);
              if (resolvedIds) {
                ids.push(...resolvedIds);
              }
            } else if (t.isSpreadElement(arg)) {
              const resolvedIds = resolveIdentifier(
                arg.argument.name,
                path.scope
              );
              if (resolvedIds) {
                ids.push(...resolvedIds);
              }
            }
          }
        }
      },
    });
    return [ids, hasDeprecatedFunction];
  } catch (error) {
    console.error(`Error parsing file: ${filePath}`);
    console.error(error);
    return [[], false];
  }
}

async function parseDirectory(directoryPath) {
  const ids = [];
  const files = await readdir(directoryPath);

  for (const file of files) {
    const filePath = path.join(directoryPath, file);

    if (await isExcludedDir(filePath)) {
      continue;
    }

    const fileStat = await stat(filePath);

    if (
      fileStat.isFile() &&
      (filePath.endsWith(".js") || filePath.endsWith(".gjs"))
    ) {
      const [parsedIds, hasDeprecatedFunction] = await parseFile(filePath);

      if (hasDeprecatedFunction && parsedIds.length === 0) {
        console.log(`DEBUG THE FILE: ${filePath}`);
        filesToDebug.push(filePath);
      }

      ids.push(...parsedIds);
    } else if (fileStat.isDirectory()) {
      ids.push(...(await parseDirectory(filePath)));
    }
  }

  return ids;
}

// Main script
(async () => {
  if (process.argv.length < 3) {
    console.log("Usage: node update_discourse_deprecations.js <CODEBASE_DIR>");
    process.exit(1);
  }

  const directoryPath = process.argv[2];
  const idsParsed = await parseDirectory(directoryPath);
  const ids = [...new Set(
    [
      ...idsParsed,
      ...idsToInclude
    ]
  )].sort();

  if (filesToDebug.length > 0) {
    const filesToDebugFilePath = path.join(
      ".",
      "scripts",
      "files_to_debug.txt"
    );
    fs.writeFileSync(filesToDebugFilePath, filesToDebug.join("\n"));
  }

  const deprecationIdsFilePath = path.join(
    ".",
    "lib",
    "deprecation_collector",
    "deprecation-ids.yml"
  );
  const deprecationIds = yaml.load(
    fs.readFileSync(deprecationIdsFilePath, "utf8")
  );
  deprecationIds["discourse_deprecation_ids"] = ids;
  fs.writeFileSync(
    deprecationIdsFilePath,
    "---\n" + yaml.dump(deprecationIds, { noArrayIndent: true }),
    "utf8"
  );
  console.log(`${ids.length} Extracted IDs saved to ${deprecationIdsFilePath}`);
})();
