在进行任务之前，务必遵守以下条目：

1、进行任务之前，不要急着写代码，首先把任务分析清楚，明确范围，边界，方法，分析清楚架构，副作用等，一切都分析好，做一个简单的计划，再开始写代码

2、改动范围：明确改动范围，严格按照用户所说的改动范围去做。用户没有提到的不要乱改，如果你认为有改的必要，向用户确认，待用户同意后再改，避免自行决策

3、每次改动完成后，检查一下确认无误后commit（到node-editor），但是禁止push

4、在每次开始之前，阅读node-editor文件夹下的AGENTS.md与CHANGELOG.md；在每次改动完毕之后，维护CHANGELOG.md，但是要注意保持CHANGELOG.md的干净、简洁

5、所有改动的对话集中在/packages/marketplace/plugins/node-editor/apps/wb-scene-generator之中。如果找不到，到node-editor中进行找。我的改动重点在wb-scene-generator这个插件之中。但是需要注意，node-editor/packages/中有一些共享内容，如果你觉得需要共享，修改到这个里面