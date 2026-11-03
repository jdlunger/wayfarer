/**
 * Random weird quips villagers and animals mutter to themselves while going about their day.
 */

const pick = <T>(a: T[]) => a[(Math.random() * a.length) | 0];

/** Things anyone in the village might say. */
const VILLAGE: string[] = [
  'I think the well is judging me.',
  'Has anyone else noticed the moon follows you home?',
  'I had a dream I was a spoon. A happy spoon.',
  'Some days I just stare at a turnip and feel things.',
  'If I had a boat, I would name it Gerald.',
  'I counted the cobblestones. Twice. Different numbers.',
  'My left shoe has been acting suspicious.',
  'Do clouds get tired? Asking for a cloud.',
  'I licked a frog once. Long story. Purple week.',
  'What if chickens are just very small, very angry dragons?',
  'I am ninety percent soup by now.',
  'The wind owes me a hat.',
  "I've decided I'm a morning person. Starting tomorrow. Probably.",
  'Do you ever just… lean?',
  "Somebody's been rearranging my thoughts.",
  'I told a rock a secret. It kept it.',
  'Is it weird to wave at the sky? Asking because I did.',
  'I wonder what bread dreams about.',
  'One day I will learn to whistle. One day.',
  'My grandmother was a lighthouse. Metaphorically. Mostly.',
  'Nobody tell the goat about Tuesday.',
  "I've been practicing my mysterious face. How's this?",
  'If you stand very still, the pigeons accept you as one of their own.',
  "I'm not lost, I'm just exploring in the wrong direction.",
  'Do mushrooms gossip? They look like they gossip.',
  'I sneezed so hard I saw the future. It was mostly cabbage.',
  "The trains have been looking at me funny.",
  'Remember when it rained frogs? No? Just me?',
  'I have a lucky pebble. It has not been lucky.',
  'Some say the hermit is three raccoons in a cloak.',
  "I'd tell you a joke about the weather, but it keeps changing.",
  'Hum hum hum… I forget the rest.',
  "There's a squirrel out there that knows what I did.",
  "Whose turn is it to feed the moon?",
  'I put my socks on in the wrong order today. Everything feels off.',
  'Sometimes I talk to the lanterns. They listen better than people.',
  "Wouldn't it be funny if the island was a giant turtle? …Ha. Ha. Haha. Unless?",
  "I'm saving up for a slightly larger hat.",
  "I've named every cloud today. That one's Bartholomew.",
  'Do you think fish know they are wet?',
  'I keep a diary. It is mostly drawings of ducks.',
  'Hold on, I had a thought. …It left.',
  'If I stare at the sea long enough, it blinks first.',
  'Apple. Apple. Apple. Huh, it stopped sounding like a word.',
  'Every time I hear a bell I think of something embarrassing.',
  'I have opinions about gravel.',
  "I don't trust stairs. They're up to something.",
  "What's the plural of moose? Mooses? Meese? Moosen?",
  'I bet the geysers are just the island burping.',
  'Do not eat the blue berries. Or do. Live your life.',
  'Pretty sure my reflection blinked late.',
  "I'm thinking of starting a band. Just me and a bucket.",
  "I've been awake since yesterday.",
  'Who keeps leaving tiny hats on the mushrooms?',
  'I think I left the oven on. I do not own an oven.',
  'Everyone here is normal. Very normal. Suspiciously normal.',
  'Never trust a duck with a plan.',
  'My knees predict rain. They are usually wrong.',
  "I'm not eavesdropping, I'm listening aggressively.",
  'If you hear humming at night, no you didn\'t.',
];

/** Extra lines for specific villagers, keyed by NPC id. */
const PERSONAL: Record<string, string[]> = {
  maren: ['In my day, we had one lantern and we were grateful.', 'The ancestors are watching. Mostly the nosy ones.', 'I am the elder. I am allowed to nap whenever.', 'Wisdom is just remembering where you left your keys.'],
  tobin: ['I once forged a spoon so strong it bent the soup.', "Iron doesn't lie. Copper, though…", 'My hammer has a name. It is Hammer.', 'Hot, hot, hot. Everything is hot. Always.'],
  pip: ['I can lick my elbow. Watch. …Okay, not now.', "I found a bug and named it Captain.", 'When I grow up I want to be a cloud.', 'Bet I can jump higher than the bakery!', 'Grown-ups are just tall kids with taxes.'],
  lotte: ['Mittens can talk. She just chooses not to.', "I'm practicing being invisible. Can you see me?", 'I have a secret. It is a rock.', 'Flowers are just the ground showing off.'],
  ilsa: ['One portrait, slightly haunted, very affordable!', 'I once sold a cloud. Well, a jar of it.', 'Everything has a price. Except Brann. Brann is free.', 'Buying spoons! Selling forks! Do not ask why!'],
  brann: ['Stand guard. Stand guard. Still standing guard.', 'If a duck tries anything, I am ready.', 'My sword is mostly for pointing at things.', 'I have guarded this gate for years. Nobody has tried the gate.'],
  wren: ['Cabbages have feelings. Small, leafy feelings.', 'I talk to my carrots. They grow out of embarrassment.', 'The chickens are planning something.', 'One day the turnips will rise. I will be ready.'],
  hollis: ['Sourdough is just bread with trust issues.', 'I put a raisin in every loaf. For luck. And chaos.', 'The oven hums at night. We have an understanding.', 'Flour gets everywhere. I found some in my dreams.'],
  garrick: ['Every tree has a story. This one\'s was about a squirrel.', 'I apologize to every log first.', 'My beard holds three acorns at all times. For emergencies.', 'Wood. Wood. Good wood. More wood.'],
  fennick: ['♪ A song about a sock, a sad and lonely sock ♪', '♪ Oh the turnip, the beautiful turnip ♪', 'I know nine chords. Eight of them by accident.', '♪ Doo-be-doo… what rhymes with Thistlewick? ♪'],
  bertram: ['Back in my day, the sea was further away.', 'I fought a goose in my youth. The goose won.', 'Eh? What? Oh. Yes. Exactly.', 'I remember when hills were flatter.'],
  nell: ['These sheets have seen things.', 'Someone keeps washing their socks with frogs in them.', 'I can fold anything. I folded a ghost once.', 'Mud is just dirt that gave up.'],
  jory: ['I carried a crate so heavy it carried me.', 'What is IN these boxes? Nobody tells me.', 'My back makes music now. Crunchy music.', 'Lift with the legs. And the soul.'],
  moss: ['The mushrooms whisper. Mostly about you.', 'A potion for everything. Except Tuesdays.', 'I accidentally turned my kettle into a toad. It makes great tea.', 'Ooh, that rock is giving off weird energy.'],
  odo: ['I caught a fish this big once. It caught me back.', 'The fish know my name. They tell each other.', 'Shh. The sea is thinking.', 'If I fall asleep, wake me if a fish shows up.'],
  sela: ['The hill sees all. The hill is bored.', 'I came up here for peace. The goats did not.', 'Down there, everyone is very loud.', 'The stars owe me money.'],
};

/** Weird inner thoughts, wrapped in the animal's own noise. */
const ANIMAL_THOUGHTS: string[] = [
  'I have seen the void. It had snacks.',
  'Where do the humans go when they go inside?',
  'I am thinking about bread.',
  'That cloud looks like me.',
  'Today I will be brave. Tomorrow, nap.',
  'I have a plan. I forgot the plan.',
  'The tall ones are so weird.',
  'Everything smells like adventure.',
  'Am I a good animal? I think I am a good animal.',
  'The grass tastes like Tuesday.',
  'I am the captain now.',
  'What if I just… ran in a circle?',
  'I saw a leaf move. Suspicious.',
  'One day I will touch the moon.',
  'My legs are full of zoomies.',
  "Is the sky a big lid?",
  "I don't like that rock.",
  'I am secretly very important.',
];

const ANIMAL: Record<string, string[]> = {
  chicken: ['BAWK. (The sky is a lie.)', 'Bok bok. (I laid an egg and I am NOT telling where.)', 'Cluck. (Revenge will be mine, farmer.)', 'BAWK BAWK. (I am descended from dragons.)'],
  dog: ['Woof! (Everyone is my best friend!)', 'Arf! (I heard a noise. It was me.)', 'Wruff. (Is that a stick? Is EVERYTHING a stick?)', 'Woof woof! (I love you. I love you. Who are you?)'],
  cat: ['Mrrp. (I own this village.)', 'Meow. (You may pet me. Twice. Then perish.)', '*purr* (Knocking things off tables is an art.)', 'Mew. (I have nine plans and they are all naps.)'],
  sheep: ['Baa. (I am basically a cloud with legs.)', 'Baaa. (Do not count me. I hate being counted.)', 'Meh-eh-eh. (Wool you be my friend?)'],
  cow: ['Moo. (I have been chewing this since spring.)', 'Mooo. (The moon looked at me funny.)', 'Moooo. (Milk? Never heard of her.)'],
  pig: ['Oink. (Mud is a lifestyle.)', 'Snrk. (I am a truffle prophet.)', 'Oink oink. (I would like one of everything.)'],
  frog: ['Ribbit. (I am the king of this lily pad.)', 'Croak. (I know things. Frog things.)', 'Rrrbt. (Do not lick me. Seriously.)'],
  duck: ['Quack. (I have a plan. Trust me.)', 'Quack quack. (Bread is my religion.)', 'QUACK. (The pond is mine. The pond has always been mine.)'],
  gull: ['CAW! (MINE!)', 'Kee-ow! (Everything is MINE!)', 'Caw caw! (I stole a sandwich and I would do it again.)'],
  pigeon: ['Coo. (I am the eyes of the city.)', 'Coo-roo. (We are everywhere.)', 'Coo. (Crumbs. Crumbs. Crumbs.)'],
  crow: ['CAW. (I remember your face.)', 'Kraa. (Shiny things. Must have shiny things.)', 'Caw caw. (I know where the bodies are buried. They are acorns.)'],
  goat: ['MEHHH. (I will eat your hat.)', 'Bleat. (I climbed that just to say I did.)', 'Meeeh! (Rules are for sheep.)'],
  fox: ['Yip! (Nobody suspects the fox.)', '*sniff* (Chickens… nearby…)'],
  deer: ['*snort* (I am majestic. Look at me.)', '*sniff* (Was that a twig? That was a twig.)'],
  rabbit: ['*thump* (DANGER! …No, never mind.)', '*sniff* (I am very fast and very small and very worried.)'],
};

/** A weird ambient line for a villager. */
export function villagerQuip(id: string): string {
  const own = PERSONAL[id];
  return own && Math.random() < 0.45 ? pick(own) : pick(VILLAGE);
}

/** A weird ambient line for an animal, built from its own sounds. */
export function animalQuip(kind: string, sounds: string[]): string {
  const own = ANIMAL[kind];
  if (own && Math.random() < 0.55) return pick(own);
  return `${pick(sounds)} (${pick(ANIMAL_THOUGHTS)})`;
}
