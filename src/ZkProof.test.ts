import { silentproof, User, MerkleWitness4, treeHeight } from './silentproof';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  MerkleTree,
  CircuitString,
  Poseidon,
} from 'snarkyjs';

let proofsEnabled = false;

function createUser(username: string) {
  const user = new User({
    username: Poseidon.hash(CircuitString.fromString(username).toFields()),
  });
  return user;
}

function createTree(): any {
  const tree = new MerkleTree(treeHeight);

  const user1 = createUser('Alice');
  const user2 = createUser('Bob');
  const user3 = createUser('Charlie');

  tree.setLeaf(0n, Poseidon.hash(User.toFields(user1)));
  tree.setLeaf(1n, Poseidon.hash(User.toFields(user2)));
  tree.setLeaf(2n, Poseidon.hash(User.toFields(user3)));

  return tree;
}

describe('silentproof', () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    senderAccount: PublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    silentproof: silentproof,
    tree: MerkleTree;

  beforeAll(async () => {
    if (proofsEnabled) await silentproof.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } =
      Local.testAccounts[0]);
    ({ privateKey: senderKey, publicKey: senderAccount } =
      Local.testAccounts[1]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    silentproof = new silentproof(zkAppAddress);
    tree = createTree();
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      silentproof.deploy();
      silentproof.initState(tree.getRoot());
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('deploys the `silentproof` smart contract', async () => {
    await localDeploy();
    const treeRoot = silentproof.treeRoot.get();
    expect(treeRoot).toEqual(tree.getRoot());
  });

  it('allows a user to join the protest', async () => {
    await localDeploy();

    const user = createUser('David');
    const path = new MerkleWitness4(tree.getWitness(1n));
    const salt = Field.random();

    const txn = await Mina.transaction(senderAccount, () => {
      silentproof.verifydata(user, salt, path);
    });
    await txn.prove();
    await txn.sign([senderKey]).send();

    const numAttendees = silentproof.numAttendees.get();
    expect(numAttendees).toEqual(Field(1));
  });

  it('rejects a user that is already part of the protest', async () => {
    await localDeploy();

    // Join attempt
    const user = createUser('Eve');
    const path = new MerkleWitness4(tree.getWitness(0n));
    const salt = Field.random();

    const txn = await Mina.transaction(senderAccount, () => {
      silentproof.verifydata(user, salt, path);
    });
    await txn.prove();
    await txn.sign([senderKey]).send();

    // Second join attempt with the same user object and salt
    await expect(async () => {
      const txn = await Mina.transaction(senderAccount, () => {
        silentproof.verifydata(user, salt, path);
      });

      await txn.prove();
      await txn.sign([senderKey]).send();
    }).rejects.toThrow(/User is already part of the protest/);
  });

  it('updates the tree root when a user joins protest', async () => {
    await localDeploy();

    const initialTreeRoot = silentproof.treeRoot.get();
    const user = createUser('Frank');
    const path = new MerkleWitness4(tree.getWitness(1n));
    const salt = Field.random();

    const txn = await Mina.transaction(senderAccount, () => {
      silentproof.verifydata(user, salt, path);
    });
    await txn.prove();
    await txn.sign([senderKey]).send();

    const updatedTreeRoot = silentproof.treeRoot.get();
    expect(updatedTreeRoot).not.toEqual(initialTreeRoot);
  });

  it('gets the number of attendees', async () => {
    await localDeploy();

    const user = createUser('Gary');
    const path = new MerkleWitness4(tree.getWitness(1n));
    const salt = Field.random();

    const txn = await Mina.transaction(senderAccount, () => {
      silentproof.verifydata(user, salt, path);
    });
    await txn.prove();
    await txn.sign([senderKey]).send();

    const numAttendees = silentproof.getCount();
    expect(numAttendees).toEqual(Field(1));
  });
});
