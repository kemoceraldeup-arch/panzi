// src/screens/ProfileSurveyScreen.tsx
//
// Collected once, right after account creation (email or guest).
// This is the seed data for the future AI recipe engine — dietary
// preferences let it filter suggestions, and the meal-plan opt-in decides
// whether it proactively pushes plans vs. only responding when asked.

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../config/firebaseClient';
import { saveSurvey } from '../services/profile';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

const DIETARY_OPTIONS = [
  'No restrictions',
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Gluten-free',
  'Dairy-free',
];

const NAME_MAX_LENGTH = 40;
const ALLERGIES_MAX_LENGTH = 200;
// Letters (incl. accented), spaces, and a few common name punctuation marks.
const NAME_PATTERN = /^[\p{L}\s'.-]+$/u;

function getNameError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter your name.';
  if (trimmed.length < 2) return 'Name is too short.';
  if (trimmed.length > NAME_MAX_LENGTH) return `Keep it under ${NAME_MAX_LENGTH} characters.`;
  if (!NAME_PATTERN.test(trimmed)) return 'Only letters, spaces, and - . \' are allowed.';
  return null;
}

function getAllergiesError(value: string): string | null {
  if (value.trim().length > ALLERGIES_MAX_LENGTH) {
    return `Keep it under ${ALLERGIES_MAX_LENGTH} characters.`;
  }
  return null;
}

type Props = {
  onContinue: () => void;
};

export default function ProfileSurveyScreen({ onContinue }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [dietary, setDietary] = useState<string[]>([]);
  const [mealPlanOptIn, setMealPlanOptIn] = useState(true);
  const [allergies, setAllergies] = useState('');
  const [saving, setSaving] = useState(false);
  // Set by a Continue press that could not go through. Until then a field the
  // user has not reached yet is not "wrong" — it is unanswered, and colouring
  // it red on arrival would tell them off for a form they have barely started.
  const [submitted, setSubmitted] = useState(false);

  const nameError = getNameError(name);
  const allergiesError = getAllergiesError(allergies);
  const dietaryError = dietary.length === 0 ? 'Pick at least one — "No restrictions" counts.' : null;

  const canContinue = !nameError && !allergiesError && !dietaryError;

  // Each field turns red once it has been left, or once Continue has been
  // pressed and it is the reason nothing happened.
  const showNameError = (nameTouched || submitted) && !!nameError;
  const showDietaryError = submitted && !!dietaryError;

  function toggleDietary(option: string) {
    if (option === 'No restrictions') {
      setDietary(['No restrictions']);
      return;
    }
    setDietary((prev) => {
      const withoutNoRestrictions = prev.filter((o) => o !== 'No restrictions');
      return withoutNoRestrictions.includes(option)
        ? withoutNoRestrictions.filter((o) => o !== option)
        : [...withoutNoRestrictions, option];
    });
  }

  async function handleContinue() {
    if (!canContinue) {
      // The button stays pressable on purpose. A disabled button is silent
      // about which field is holding it up, and the user is left comparing
      // what they typed against a control that will not react at all.
      setSubmitted(true);
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert('Something went wrong', "You're not signed in — try again from the previous screen.");
      return;
    }
    setSaving(true);
    try {
      const savePromise = saveSurvey(uid, {
        name: name.trim(),
        dietary,
        allergies: allergies.trim(),
        mealPlanOptIn,
      });
      // Kept from the Firestore version, for a different reason: apiFetch
      // checks that the server is reachable before the real request, but a
      // server that accepts the connection and then stalls would still leave
      // this button spinning forever.
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Taking too long — check your connection and try again.')), 10000)
      );
      await Promise.race([savePromise, timeout]);
      onContinue();
    } catch (err: any) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View>
              <View style={styles.header}>
                <Text style={styles.title}>Tell Panzi about you.</Text>
                <Text style={styles.description}>
                  This shapes every recipe suggestion — what fits your diet, how much to cook, and what to flag before it goes bad.
                </Text>
              </View>

              <View style={styles.body}>
                <Text style={styles.label}>What should Panzi call you?</Text>
                <TextInput
                  style={[styles.input, showNameError && styles.inputError]}
                  placeholder="Your name"
                  placeholderTextColor={colors.textSecondary}
                  value={name}
                  onChangeText={(text) =>
                    // autoCapitalize="words" is only a keyboard hint — the
                    // stored value stays whatever was actually typed, so a
                    // lowercase first letter (autocorrect off, pasted text,
                    // an IME that ignores the hint) went through unchanged.
                    // Forcing it here means the name really is always
                    // capitalized, not just usually.
                    setName(text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text)
                  }
                  onBlur={() => setNameTouched(true)}
                  maxLength={NAME_MAX_LENGTH}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                {showNameError && <Text style={styles.errorText}>{nameError}</Text>}

                <Text style={styles.label}>Any dietary preferences?</Text>
                <View style={[styles.chipRow, showDietaryError && styles.chipRowError]}>
                  {DIETARY_OPTIONS.map((option) => {
                    const selected = dietary.includes(option);
                    return (
                      <TouchableOpacity
                        key={option}
                        onPress={() => toggleDietary(option)}
                        style={[styles.chip, selected && styles.chipSelected]}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {option}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {showDietaryError && <Text style={styles.errorText}>{dietaryError}</Text>}

                <Text style={styles.label}>Allergies or foods to avoid (optional)</Text>
                <TextInput
                  style={[styles.input, allergiesError && styles.inputError]}
                  placeholder="e.g. peanuts, shellfish"
                  placeholderTextColor={colors.textSecondary}
                  value={allergies}
                  onChangeText={setAllergies}
                  maxLength={ALLERGIES_MAX_LENGTH}
                  returnKeyType="done"
                />
                {allergiesError && <Text style={styles.errorText}>{allergiesError}</Text>}

                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Send me weekly meal plan ideas</Text>
                  <Switch
                    value={mealPlanOptIn}
                    onValueChange={setMealPlanOptIn}
                    // Same fix as the Dark mode switch on the Profile tab —
                    // see the note there. 1.24:1 against the card was invisible.
                    trackColor={{ true: colors.primary, false: colors.tabInactive }}
                    ios_backgroundColor={colors.tabInactive}
                    thumbColor={colors.onAccent}
                  />
                </View>
              </View>

              <View style={styles.footer}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleContinue}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Continue</Text>
                  )}
                </TouchableOpacity>
                {submitted && !canContinue && (
                  <Text style={styles.hintText}>Fill in the fields marked in red above.</Text>
                )}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 0,
  },
  header: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
  },
  title: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.sm,
  },
  description: {
    fontSize: type.bodySmall.fontSize,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  body: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xs,
  },
  label: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.sm2,
    marginTop: space.xl,
  },
  input: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.error,
    marginTop: space.xs2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  // The chips are the answer to a required question but are not a field with a
  // border of its own, so the red has to be drawn around the group. Padding
  // rather than a bare border, or the ring would sit on top of the outer chips.
  chipRowError: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 16,
    padding: space.sm,
    margin: -8,
  },
  chip: {
    paddingVertical: space.sm2,
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.onAccent,
  },
  toggleRow: {
    marginTop: space.xl2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 18,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    marginRight: space.md,
  },
  footer: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  primaryButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
  },
  hintText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.sm2,
  },
}));