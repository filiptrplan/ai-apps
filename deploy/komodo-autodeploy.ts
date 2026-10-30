// Deploys the ai-apps stack when its `deploy` branch has a commit that isn't
// deployed yet. (DeployStackIfChanged only notices compose file changes.)
// Each commit is tried once: after a failed deploy, it waits for the next one.
const STACK = "ai-apps";
const TRIED = "AI_APPS_LAST_ATTEMPTED";

async function main() {
  await komodo.write("RefreshStackCache", { stack: STACK });
  const { info } = await komodo.read("GetStack", { stack: STACK });
  const latest = info.latest_hash;
  if (!latest || latest === info.deployed_hash) return;
  const tried = (await komodo.read("GetVariable", { name: TRIED })).value;
  if (latest === tried) return;
  await komodo.write("UpdateVariableValue", { name: TRIED, value: latest });
  console.log(`deploying ${latest} (deployed: ${info.deployed_hash})`);
  await komodo.execute_and_poll("DeployStack", { stack: STACK });
}

await main();
