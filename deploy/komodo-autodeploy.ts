// Komodo Action `github autodeploy` (run every minute by the procedure of the
// same name). Kept here for reference; the copy in Komodo is the one that runs.
//
// For each stack below, deploys it when its `deploy` branch has a commit that
// isn't deployed yet. (DeployStackIfChanged only notices compose file changes.)
// Each commit is tried once: after a failed deploy, it waits for the next one.
// The last attempted commit per stack lives in the Komodo variable
// <STACK>_LAST_ATTEMPTED (e.g. AI_APPS_LAST_ATTEMPTED), which must exist.
//
// GitHub CI in each repo fast-forwards `deploy` after green checks on the main
// branch; the stack (or its linked repo) must track `deploy`.
const STACKS = ["ai-apps", "personal-mcp"];

async function deployIfNew(stack: string) {
  const tried_var = `${stack.toUpperCase().replace(/-/g, "_")}_LAST_ATTEMPTED`;
  await komodo.write("RefreshStackCache", { stack });
  const { info } = await komodo.read("GetStack", { stack });
  const latest = info.latest_hash;
  if (!latest || latest === info.deployed_hash) return;
  const tried = (await komodo.read("GetVariable", { name: tried_var })).value;
  if (latest === tried) return;
  await komodo.write("UpdateVariableValue", { name: tried_var, value: latest });
  console.log(`${stack}: deploying ${latest} (deployed: ${info.deployed_hash})`);
  await komodo.execute_and_poll("DeployStack", { stack });
}

let failed = false;
for (const stack of STACKS) {
  try {
    await deployIfNew(stack);
  } catch (e) {
    failed = true;
    console.error(`${stack}: ${e}`);
  }
}
if (failed) throw new Error("at least one stack failed; see the log above");
