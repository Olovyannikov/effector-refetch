/** Shared fake DB for the API route handlers. */
export interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: string;
  location: string;
  bio: string;
}

export const USERS: UserRecord[] = [
  {
    id: 1,
    name: 'Ada Lovelace',
    email: 'ada@calc.dev',
    role: 'Analyst engine programmer',
    location: 'London',
    bio: 'Wrote the first published algorithm intended for a machine — notes on the Analytical Engine, 1843.',
  },
  {
    id: 2,
    name: 'Grace Hopper',
    email: 'grace@navy.mil',
    role: 'Rear admiral, compiler pioneer',
    location: 'Arlington',
    bio: 'Built the first compiler (A-0) and led the team behind COBOL. Popularized the term "debugging".',
  },
  {
    id: 3,
    name: 'Margaret Hamilton',
    email: 'margaret@apollo.nasa',
    role: 'Director of Software Engineering, Apollo',
    location: 'Cambridge, MA',
    bio: 'Led the team that wrote the Apollo Guidance Computer software; coined "software engineering".',
  },
  {
    id: 4,
    name: 'Katherine Johnson',
    email: 'katherine@nasa.gov',
    role: 'Orbital mechanics mathematician',
    location: 'Hampton',
    bio: 'Calculated trajectories for Mercury and Apollo 11; John Glenn asked for her by name to verify the computer.',
  },
  {
    id: 5,
    name: 'Barbara Liskov',
    email: 'barbara@mit.edu',
    role: 'Professor, MIT',
    location: 'Cambridge, MA',
    bio: 'Turing Award 2008. CLU, abstract data types, and the substitution principle bearing her name.',
  },
];
