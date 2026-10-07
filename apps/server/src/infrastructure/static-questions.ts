import type { QuestionProvider } from '../application/ports.js';

/** Fixed sample content for M2. A generator/seed contract is deliberately separate. */
const content = [
  {
    id: 'science',
    name: 'Science',
    questions: [
      { text: 'Water is made of hydrogen and oxygen.', correct: true },
      { text: 'Earth is the closest planet to the Sun.', correct: false },
      { text: 'Light travels faster than sound in air.', correct: true },
      { text: 'A human adult normally has three lungs.', correct: false },
      { text: 'Plants can use sunlight in photosynthesis.', correct: true },
    ],
  },
  {
    id: 'geography',
    name: 'Geography',
    questions: [
      { text: 'Tokyo is the capital of Japan.', correct: true },
      { text: 'The Nile is a river in South America.', correct: false },
      { text: 'Australia is both a country and a continent.', correct: true },
      { text: 'The Pacific is the smallest ocean.', correct: false },
      { text: 'Mount Everest is in the Himalayas.', correct: true },
    ],
  },
  {
    id: 'mathematics',
    name: 'Mathematics',
    questions: [
      { text: 'A triangle has three sides.', correct: true },
      { text: 'Seven is an even number.', correct: false },
      { text: 'The square root of nine is three.', correct: true },
      { text: 'One hundred divided by ten is five.', correct: false },
      { text: 'A right angle measures ninety degrees.', correct: true },
    ],
  },
] as const;
export const staticQuestions: QuestionProvider = {
  categories: content.map((category) => ({
    id: category.id,
    name: category.name,
    language: 'en',
  })),
  prepare: async (request) => {
    if (request.signal.aborted) throw new Error('Preparation cancelled');
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
