implement the changes recommended by the audit and fix the problems it surfaced.

do not edit documentation files.

do not be afraid to ask me questions. im here for them. do not suppose anything nor guess, ask me. if anything is unclear at all, ask me. make your questions and options verbose, always include an open answer.

do not edit card yml files, if you feel like a card should be better written to fit with the compiler and the rest of the cards, ask me directly using the QA tool.

RULES.md is the source of truth for how the game should behave. docs/ is the source of truth for how it is implemented. do not waste token reading large files when the information you need is already in docs/.

start by reading PROJECT_RESURRECTION_PLAN.md, RULES.md, and all the md files in docs/ before you start making changes, to understand the scope of the project.

if you check of a todo item, simply change `[ ]` to `[x]` on that item. do not make any modifications to TODO.md besides that.

always follow these principles:

maximize and thrive for excelent, enterprise-level design and architecture, code cleanliness, maintainability, extensibility, and scalability. identify exactly what is the purpose of these changes and their role in the overall project and project resurrection. identify all the gaps, pitfalls, and features that need to be addressed in this feature. provide clear acceptance criteria for each task. ensure that the changes align with the overall project resurrection goals and objectives. the most important thing here that i need you to constantly keep in mind is that we need to expect that the most unique and complex cards, interactions, and game mechanics will be added to the game in the future, and it needs to be designed to handle everything that any hypothetical game mechanic can throw at it. don't be too afraid to overengineer the architecture in the pursuit of perfection.

make sure that the implemented components are well encorporated into the existing project, and not just thrown in as an independent module. the implementation should feel like it fits in with the existing code.

every component should be thoroughly tested.

every single time you find a new bug, write a test for it after you solve it. i don't care if the test needs to be super specific to cover this bug, i want it.
