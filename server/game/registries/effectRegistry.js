import TestConsoleLogOnTurnEnd from "../effects/triggered/TestConsoleLogOnTurnEnd.js";
import TestConsoleLogOnTurnEndUntilRoundEnd from "../effects/continuous/TestConsoleLogOnTurnEndUntilRoundEnd.js";
import DrawCardTurnEnd from "../effects/continuous/DrawCardTurnEnd.js";

export default {
  "test-console-log-on-turn-end": TestConsoleLogOnTurnEnd,
  "test-console-log-on-turn-end-until-round-end": TestConsoleLogOnTurnEndUntilRoundEnd,
  "draw-card-turn-end": DrawCardTurnEnd,
};
