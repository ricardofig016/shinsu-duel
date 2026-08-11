carefully analyse Rules.md, the plan for phase 2 in plans/phase2/plan.md, the files in docs/, and the project in depth and determine whether it was completed successfully or not. which areas are incomplete/ignored, if the behaviour and instructions in the plans/phase/prompt.md (initial plan prompt) were followed, organize each non-compliance by criticality, identify hard to miss flaws, and report back with your findings. keep your report short so the coding agent can easily take action.

differences to the plan do not necessarily mean non-compliance. things like too many tests or too many features arent non-compliance, they're just products of real life implementation a plan cant predict.

make sure the implementation also follows these core principles:

Never under any circumstances sacrifice good architecture and cleanliness for backwards compatability and legacy implementation. you should always want to fix imperfections, never patch them up.

maximize and thrive for excelent, enterprise-level design and architecture, code cleanliness, maintainability, extensibility, and scalability. identify exactly what is the purpose of these changes and their role in the overall project and project resurrection. identify all the gaps, pitfalls, and features that need to be addressed in this feature. provide clear acceptance criteria for each task. ensure that the changes align with the overall project resurrection goals and objectives. the most important thing here that i need you to constantly keep in mind is that we need to expect that the most unique and complex cards, interactions, and game mechanics will be added to the game in the future, and it needs to be designed to handle everything that any hypothetical game mechanic can throw at it. don't be too afraid to overengineer the architecture in the pursuit of perfection.

make sure that the implemented components are well encorporated into the existing project, and not just thrown in as an independent module. the implementation should feel like it fits in with the existing code.

every component should be thoroughly tested.

every single time you find a new bug, write a test for it after you solve it. i don't care if the test needs to be super specific to cover this bug, i want it.