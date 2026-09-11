import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the teacher workbench framework", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-CN"/i);
  assert.match(html, /教师个人工作台/);
  assert.match(html, /全部为虚构演示数据/);
  assert.match(html, /查看手机内容/);
  assert.match(html, /查看全部学生|学生档案/);
  assert.match(html, /家校沟通/);
  assert.match(html, /事项中心|今天先做这三件/);
  assert.match(html, /成绩、排名与近期动态/);
  assert.match(html, /阅读单第3题还空着|请假后的阅读题还没补完/);
  assert.doesNotMatch(html, /学习证据|事实时间线/);
  assert.doesNotMatch(html, /Agent|正式数据|置信度|加密数据包|仓库令牌|档案编号|129 名学生|INVALID_|UNSUPPORTED_SCHEMA|snapshotVersion|sourceRevision|storageKind/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});
