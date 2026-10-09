import type { QuestionProvider } from '../application/ports.js';

/** Fixed sample content for M2. A generator/seed contract is deliberately separate. */
const content = [
  {
    id: 'champions',
    name: 'Champions',
    questions: [
      { text: 'Ahri is known as the Nine-Tailed Fox.', correct: true },
      { text: 'Garen is a champion from Noxus.', correct: false },
      { text: 'Jinx uses a rocket launcher called Fishbones.', correct: true },
      { text: 'Teemo is a dragon.', correct: false },
      { text: 'Ashe uses a bow.', correct: true },
    ],
  },
  {
    id: 'summoners-rift',
    name: "Summoner's Rift",
    questions: [
      { text: "Summoner's Rift has three lanes.", correct: true },
      {
        text: 'Destroying a turret immediately ends the game.',
        correct: false,
      },
      { text: 'Baron Nashor is a neutral monster.', correct: true },
      { text: 'Minions are directly controlled by players.', correct: false },
      { text: 'Destroying the enemy Nexus wins the game.', correct: true },
    ],
  },
  {
    id: 'items-and-spells',
    name: 'Items and spells',
    questions: [
      { text: 'Flash is a summoner spell.', correct: true },
      { text: 'Recall is a purchasable item.', correct: false },
      { text: 'Gold is used to purchase items.', correct: true },
      { text: 'Boots always reduce movement speed.', correct: false },
      { text: 'Smite can be used on jungle monsters.', correct: true },
    ],
  },
] as const;
export const staticQuestions: QuestionProvider = {
  categories: (topicId) =>
    topicId === 'league-of-legends'
      ? content.map((category) => ({
          id: category.id,
          name: category.name,
          language: 'en',
        }))
      : [],
  prepare: async (request) => {
    if (request.signal.aborted) throw new Error('Preparation cancelled');
    if (request.topicId !== 'league-of-legends')
      throw new Error('Topic unavailable');
    const category = content.find((item) => item.id === request.categoryId);
    if (!category) throw new Error('Category unavailable');
    return category.questions.map((question, index) => ({
      id: `${request.matchId}:${category.id}:${index + 1}`,
      categoryId: category.id,
      language: 'en',
      type: 'single',
      text: question.text,
      options: [
        { id: 'true', text: 'True' },
        { id: 'false', text: 'False' },
      ],
      correctOptionIds: [question.correct ? 'true' : 'false'],
    }));
  },
};
